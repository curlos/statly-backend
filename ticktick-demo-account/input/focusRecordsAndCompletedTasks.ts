import atomicHabits from './focusRecordsAndCompletedTasks/001-atomic-habits';
import harryPotter from './focusRecordsAndCompletedTasks/002-harry-potter-and-the-sorcerers-stone'

// Combine all data from individual files
const allData = {
  "Books": {
    ...atomicHabits,
    ...harryPotter
  },
};

export default allData;
