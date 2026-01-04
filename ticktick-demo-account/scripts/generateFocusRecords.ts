import mongoose from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// INTERFACES
// ============================================================================

interface TaskRecord {
  duration: string;
  taskTitle: string;
  completedTasks: string[];
  note?: string;
}

interface ProjectData {
  [projectName: string]: {
    [dateTime: string]: TaskRecord[];
  };
}

interface Task {
  taskId: string;
  title: string;
  tags: string[];
  projectName: string;
  startTime: string;
  endTime: string;
}

interface FocusRecord {
  startTime: string;
  pauseDuration: number;
  endTime: string;
  status: number;
  id: string;
  tasks: Task[];
  added: boolean;
  note: string;
}

interface FocusRecordsOutput {
  add: FocusRecord[];
  update: any[];
  delete: any[];
}

interface CompletionTimeMap {
  [taskTitle: string]: string; // taskTitle -> completionTime (ISO string)
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse time in format "5:00AM" or "11:30PM" and return hours and minutes in 24-hour format
 */
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const match = timeStr.match(/(\d{1,2}):(\d{2})(AM|PM)/i);
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }

  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }

  return { hours, minutes };
}

/**
 * Determine if a date is in Daylight Saving Time for America/New_York
 */
function isEDT(date: Date): boolean {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  // DST starts: Second Sunday in March at 2:00 AM
  // DST ends: First Sunday in November at 2:00 AM

  // Before March or after November = EST
  if (month < 2 || month > 10) return false;

  // April through October = EDT
  if (month > 2 && month < 10) return true;

  // March and November need more careful checking
  // For simplicity, we'll check if we're past the second/first Sunday
  // This is a simplified version - for exact DST boundaries, we'd need the hour too

  if (month === 2) { // March
    // Find second Sunday (DST starts)
    const firstDay = new Date(Date.UTC(year, 2, 1));
    const firstSunday = 1 + ((7 - firstDay.getUTCDay()) % 7);
    const secondSunday = firstSunday + 7;
    return day >= secondSunday;
  }

  if (month === 10) { // November
    // Find first Sunday (DST ends)
    const firstDay = new Date(Date.UTC(year, 10, 1));
    const firstSunday = 1 + ((7 - firstDay.getUTCDay()) % 7);
    return day < firstSunday;
  }

  return false;
}

/**
 * Parse date in format "Jan 1, 2024" and return Date object
 */
function parseDate(dateStr: string): Date {
  const months: { [key: string]: number } = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  const match = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!match) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }

  const month = months[match[1]];
  const day = parseInt(match[2]);
  const year = parseInt(match[3]);

  return new Date(Date.UTC(year, month, day));
}

/**
 * Parse duration in format "17m40s" or "5m" and return total seconds
 */
function parseDuration(durationStr: string): number {
  const minutesMatch = durationStr.match(/(\d+)m/);
  const secondsMatch = durationStr.match(/(\d+)s/);

  const minutes = minutesMatch ? parseInt(minutesMatch[1]) : 0;
  const seconds = secondsMatch ? parseInt(secondsMatch[1]) : 0;

  return minutes * 60 + seconds;
}

/**
 * Convert Date object to ISO 8601 string with UTC timezone (no milliseconds)
 */
function toISOString(date: Date): string {
  // Remove milliseconds (.000) and replace Z with +0000 to match TickTick format
  return date.toISOString().replace(/\.\d{3}Z/, '+0000');
}

/**
 * Add seconds to a Date object and return new Date
 */
function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/**
 * Add minutes to a Date object and return new Date
 */
function addMinutes(date: Date, minutes: number): Date {
  return addSeconds(date, minutes * 60);
}

/**
 * Subtract 15 minutes from an ISO timestamp
 */
function subtract15Minutes(timestamp: string): string {
  const date = new Date(timestamp.replace('+0000', 'Z'));
  date.setMinutes(date.getMinutes() - 15);
  // Remove milliseconds (.000) and replace Z with +0000 to match TickTick format
  return date.toISOString().replace(/\.\d{3}Z/, '+0000');
}

/**
 * Parse CSV line respecting quoted fields
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(currentField);
      currentField = '';
    } else {
      currentField += char;
    }
  }

  fields.push(currentField);
  return fields;
}

/**
 * Escape CSV field value - always quote all fields to match TickTick's format
 */
function escapeCSVField(value: string): string {
  // Always wrap in quotes and escape any existing quotes
  return `"${value.replace(/"/g, '""')}"`;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Generate focus records from project data
 */
function generateFocusRecords(projectData: ProjectData): {
  output: FocusRecordsOutput;
  completionTimes: CompletionTimeMap;
} {

  const focusRecords: FocusRecord[] = [];
  const completionTimes: CompletionTimeMap = {};

  // Iterate over each project
  for (const projectName in projectData) {
    const dateTimeEntries = projectData[projectName];

    // Iterate over each date/time entry
    for (const dateTimeKey in dateTimeEntries) {
      const tasks = dateTimeEntries[dateTimeKey];

      // Parse the date and time from the key
      const headerMatch = dateTimeKey.match(/(.+?)\s+-\s+(.+)/);
      if (!headerMatch) {
        throw new Error(`Invalid date/time key format: ${dateTimeKey}`);
      }

      const dateStr = headerMatch[1];
      const timeStr = headerMatch[2];

      const date = parseDate(dateStr);
      const { hours, minutes } = parseTime(timeStr);

      // Convert America/New_York time to UTC
      // Add offset: EDT (UTC-4) or EST (UTC-5)
      const offset = isEDT(date) ? 4 : 5;
      date.setUTCHours(hours + offset, minutes, 0, 0);

      let previousEndTime: Date | null = null;

      // Process each task for this date/time
      tasks.forEach((taskRecord) => {
        const durationSeconds = parseDuration(taskRecord.duration);

        // Calculate start time
        let startTime: Date;
        if (previousEndTime === null) {
          startTime = new Date(date);
        } else {
          startTime = addMinutes(previousEndTime, 15);
        }

        // Calculate end time
        const endTime = addSeconds(startTime, durationSeconds);

        // Generate MongoDB ObjectID
        const recordId = new mongoose.Types.ObjectId().toString();

        // Create focus record
        const focusRecord: FocusRecord = {
          startTime: toISOString(startTime),
          pauseDuration: 0,
          endTime: toISOString(endTime),
          status: 1,
          id: recordId,
          tasks: [
            {
              taskId: '',
              title: taskRecord.taskTitle,
              tags: [],
              projectName: projectName,
              startTime: toISOString(startTime),
              endTime: toISOString(endTime),
            },
          ],
          added: true,
          note: taskRecord.note || '',
        };

        focusRecords.push(focusRecord);
        previousEndTime = endTime;

        // Track completion times for all completedTasks
        const completionTimeISO = toISOString(endTime);
        taskRecord.completedTasks.forEach((completedTask) => {
          completionTimes[completedTask] = completionTimeISO;
        });
      });
    }
  }

  return {
    output: {
      add: focusRecords,
      update: [],
      delete: [],
    },
    completionTimes,
  };
}

/**
 * Update TickTick CSV with completion times
 */
function updateTickTickCSV(
  csvPath: string,
  completionTimes: CompletionTimeMap,
  outputPath?: string
): void {
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');

  const updatedLines: string[] = [];
  let titleColumnIndex = -1;
  let statusColumnIndex = -1;
  let startDateColumnIndex = -1;
  let dueDateColumnIndex = -1;
  let createdTimeColumnIndex = -1;
  let completedTimeColumnIndex = -1;

  let updatedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Keep header metadata lines as-is (first 6 lines)
    if (i < 6) {
      updatedLines.push(line);
      continue;
    }

    // Find the column header row (line 7, index 6)
    if (i === 6) {
      const fields = parseCSVLine(line);

      titleColumnIndex = fields.indexOf('Title');
      statusColumnIndex = fields.indexOf('Status');
      startDateColumnIndex = fields.indexOf('Start Date');
      dueDateColumnIndex = fields.indexOf('Due Date');
      createdTimeColumnIndex = fields.indexOf('Created Time');
      completedTimeColumnIndex = fields.indexOf('Completed Time');

      if (
        titleColumnIndex === -1 ||
        statusColumnIndex === -1 ||
        startDateColumnIndex === -1 ||
        dueDateColumnIndex === -1 ||
        createdTimeColumnIndex === -1 ||
        completedTimeColumnIndex === -1
      ) {
        throw new Error('Required columns not found in CSV');
      }

      updatedLines.push(line);
      continue;
    }

    // Process data rows
    if (line.trim()) {
      const fields = parseCSVLine(line);
      const title = fields[titleColumnIndex];

      // Check if this task has a completion time
      if (completionTimes[title]) {
        const completionTime = completionTimes[title];
        const startTime = subtract15Minutes(completionTime);

        // Update Status to 2 (Archived) - preserves completion time on CSV import
        fields[statusColumnIndex] = '2';

        // Update Start Date, Due Date, and Created Time
        fields[startDateColumnIndex] = startTime;
        fields[dueDateColumnIndex] = startTime;
        fields[createdTimeColumnIndex] = startTime;

        // Update Completed Time
        fields[completedTimeColumnIndex] = completionTime;

        updatedCount++;
        console.log(`✓ Updated: ${title}`);
      }

      const updatedLine = fields.map(escapeCSVField).join(',');
      updatedLines.push(updatedLine);
    } else {
      updatedLines.push(line);
    }
  }

  // Use provided output path or generate default with -updated suffix
  const finalOutputPath = outputPath || (() => {
    const csvDir = path.dirname(csvPath);
    const csvBasename = path.basename(csvPath, '.csv');
    return path.join(csvDir, `${csvBasename}-updated.csv`);
  })();

  fs.writeFileSync(finalOutputPath, updatedLines.join('\n'), 'utf-8');

  console.log(`\n✓ Successfully updated ${updatedCount} tasks in CSV`);
  console.log(`✓ CSV written to: ${finalOutputPath}\n`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

const args = process.argv.slice(2);

if (args.length < 3) {
  console.error(
    '\nUsage: npm run generate-focus-records <input-ts> <output-json> <csv-file> [csv-output]'
  );
  console.error('\nExample:');
  console.error(
    '  npm run generate-focus-records focusRecordsAndCompletedTasks.ts focus-records.json TickTick-backup.csv'
  );
  console.error(
    '  npm run generate-focus-records input.ts output.json input.csv output.csv\n'
  );
  process.exit(1);
}

const inputPath = args[0];
const outputPath = args[1];
const csvPath = args[2];
const csvOutputPath = args[3]; // Optional 4th argument

if (!fs.existsSync(inputPath)) {
  console.error(`\nError: Input file not found: ${inputPath}\n`);
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`\nError: CSV file not found: ${csvPath}\n`);
  process.exit(1);
}

(async () => {
  try {
    console.log('\n=== Generating Focus Records ===\n');

    // Import the project data from TS file
    const fullInputPath = path.resolve(inputPath);
    const module = await import(fullInputPath);
    const projectData: ProjectData = module.default;

    // Part 1: Generate focus records
    const { output, completionTimes } = generateFocusRecords(projectData);

    // Write focus records to output file
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

    console.log(`✓ Generated ${output.add.length} focus records`);
    console.log(`✓ Focus records written to: ${outputPath}\n`);

    // Part 2: Update CSV with completed tasks
    console.log('=== Updating TickTick CSV ===\n');
    updateTickTickCSV(csvPath, completionTimes, csvOutputPath);

    console.log('=== Done! ===\n');
  } catch (error) {
    console.error('\nError:');
    console.error(error);
    process.exit(1);
  }
})();
