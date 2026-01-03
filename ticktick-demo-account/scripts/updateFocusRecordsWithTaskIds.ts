import * as fs from 'fs';

// ============================================================================
// INTERFACES
// ============================================================================

interface TickTickTask {
  id: string;
  title: string;
  [key: string]: any; // Other properties we don't need
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

interface FocusRecordsData {
  add: FocusRecord[];
  update: any[];
  delete: any[];
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Update focus records with TickTick task IDs
 */
function updateFocusRecordsWithTaskIds(
  focusRecordsPath: string,
  tickTickTasksPath: string
): void {
  // Read focus records
  const focusRecordsContent = fs.readFileSync(focusRecordsPath, 'utf-8');
  const focusRecordsData: FocusRecordsData = JSON.parse(focusRecordsContent);

  // Read TickTick tasks
  const tickTickTasksContent = fs.readFileSync(tickTickTasksPath, 'utf-8');
  const tickTickTasks: TickTickTask[] = JSON.parse(tickTickTasksContent);

  // Create a map of title -> id
  const titleToIdMap = new Map<string, string>();
  tickTickTasks.forEach((task) => {
    titleToIdMap.set(task.title, task.id);
  });

  console.log(`\nLoaded ${tickTickTasks.length} TickTick tasks`);
  console.log(`Processing ${focusRecordsData.add.length} focus records...\n`);

  let updatedCount = 0;
  let notFoundCount = 0;
  const notFoundTitles: string[] = [];

  // Update focus records with TickTick task IDs
  focusRecordsData.add.forEach((focusRecord) => {
    focusRecord.tasks.forEach((task) => {
      const tickTickId = titleToIdMap.get(task.title);

      if (tickTickId) {
        task.taskId = tickTickId;
        updatedCount++;
        console.log(`✓ Mapped: "${task.title}" → ${tickTickId}`);
      } else {
        notFoundCount++;
        notFoundTitles.push(task.title);
        console.log(`✗ Not found: "${task.title}"`);
      }
    });
  });

  // Write updated focus records back to file
  fs.writeFileSync(
    focusRecordsPath,
    JSON.stringify(focusRecordsData, null, 2),
    'utf-8'
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✓ Successfully updated ${updatedCount} task IDs`);

  if (notFoundCount > 0) {
    console.log(`✗ Could not find ${notFoundCount} tasks in TickTick data:`);
    notFoundTitles.forEach((title) => {
      console.log(`  - "${title}"`);
    });
  }

  console.log(`\n✓ Updated focus records written to: ${focusRecordsPath}`);
  console.log(`${'='.repeat(60)}\n`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error(
    '\nUsage: npm run update-focus-records-with-ids <focus-records.json> <ticktick-tasks.json>'
  );
  console.error('\nExample:');
  console.error(
    '  npm run update-focus-records-with-ids focus-records.json completedTaskObjectsFromTickTick.json\n'
  );
  process.exit(1);
}

const focusRecordsPath = args[0];
const tickTickTasksPath = args[1];

if (!fs.existsSync(focusRecordsPath)) {
  console.error(`\nError: Focus records file not found: ${focusRecordsPath}\n`);
  process.exit(1);
}

if (!fs.existsSync(tickTickTasksPath)) {
  console.error(
    `\nError: TickTick tasks file not found: ${tickTickTasksPath}\n`
  );
  process.exit(1);
}

try {
  updateFocusRecordsWithTaskIds(focusRecordsPath, tickTickTasksPath);
} catch (error) {
  console.error('\nError updating focus records:');
  console.error(error);
  process.exit(1);
}
