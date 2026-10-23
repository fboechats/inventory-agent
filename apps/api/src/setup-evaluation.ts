import { createEvaluationDatabase } from './evaluation-fixture.js';

// stdout is only the absolute path, suitable for shell command substitution.
console.log(createEvaluationDatabase());
