import atomicHabits from './focusRecordsAndCompletedTasks/001-atomic-habits';
import harryPotter from './focusRecordsAndCompletedTasks/002-harry-potter-and-the-sorcerers-stone'
import legoFerrariDaytonaSP3 from './focusRecordsAndCompletedTasks/003-lego-ferrari-daytona-sp3'
import legoMilleniumFalcon from './focusRecordsAndCompletedTasks/004-lego-millenium-falcon'
import legoTitanic from './focusRecordsAndCompletedTasks/005-lego-titanic'

// Combine all data from individual files
const allData = {
  "LEGO": {
    ...legoFerrariDaytonaSP3,
    ...legoMilleniumFalcon,
    ...legoTitanic
  },
  "Exercise": {},
  "Books": {
    ...atomicHabits,
    ...harryPotter
  },
  "Online Courses": {}
};

export default allData;
