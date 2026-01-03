import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const focusRecordsDir = path.join(__dirname, 'focusRecordsAndCompletedTasks');

// Read all .js files from the directory and sort them
const files = fs.readdirSync(focusRecordsDir)
  .filter(file => file.endsWith('.js'))
  .sort();

const allData = {};

// Dynamically import each file and merge the data
for (const file of files) {
  const filePath = path.join(focusRecordsDir, file);
  const module = await import(filePath);
  const data = module.default;

  // Merge the data from this file into allData
  for (const projectName in data) {
    if (!allData[projectName]) {
      allData[projectName] = {};
    }
    Object.assign(allData[projectName], data[projectName]);
  }
}

export default allData;
