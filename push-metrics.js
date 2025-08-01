// Import necessary Node.js modules
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Define the path to your Playwright JSON results file
// This assumes 'test-results.json' is generated in the root of your project
const resultsFilePath = path.join(__dirname, 'test-results.json');

// Get the Pushgateway URL from environment variables
// This is crucial for remote execution in GitHub Actions
const pushgatewayUrl = process.env.PUSHGATEWAY_URL;

// Get the GitHub Run ID to use as a unique instance label in Prometheus
const githubRunId = process.env.GITHUB_RUN_ID || 'local_run';

// Ensure the PUSHGATEWAY_URL is provided
if (!pushgatewayUrl) {
  console.error('Error: PUSHGATEWAY_URL environment variable is not set.');
  process.exit(1);
}

try {
  // Read the raw JSON data from the test results file
  const rawData = fs.readFileSync(resultsFilePath, 'utf8');
  const results = JSON.parse(rawData);

  // Initialize counters for test metrics
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;
  let durationMs = 0; // Total duration of all tests in milliseconds

  // Aggregate results from all test suites and specs
  for (const suite of results.suites) {
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        totalTests++;
        // Assuming each test has at least one result, take the duration from the first one
        durationMs += test.results[0]?.duration || 0;

        // Determine the status of the test and update counters
        switch (test.results[0]?.status) {
          case 'passed':
            passedTests++;
            break;
          case 'failed':
            failedTests++;
            break;
          case 'skipped':
            skippedTests++;
            break;
          default:
            // Handle other statuses if necessary (e.g., 'timedOut')
            break;
        }
      }
    }
  }

  // Format the aggregated metrics into Prometheus text exposition format
  // This format is what the Pushgateway expects
  const metrics = `
# TYPE playwright_test_total gauge
# HELP playwright_test_total Total number of Playwright tests.
playwright_test_total ${totalTests}
# TYPE playwright_test_passed gauge
# HELP playwright_test_passed Number of Playwright tests that passed.
playwright_test_passed ${passedTests}
# TYPE playwright_test_failed gauge
# HELP playwright_test_failed Number of Playwright tests that failed.
playwright_test_failed ${failedTests}
# TYPE playwright_test_skipped gauge
# HELP playwright_test_skipped Number of Playwright tests that were skipped.
playwright_test_skipped ${skippedTests}
# TYPE playwright_test_duration_milliseconds gauge
# HELP playwright_test_duration_milliseconds Total duration of all Playwright tests in milliseconds.
playwright_test_duration_milliseconds ${durationMs}
`;

  // Define the Prometheus job name and instance name
  // The instance name should be unique per GitHub Actions run for better tracking
  const jobName = 'playwright_tests';
  const instanceName = githubRunId; // Using the GitHub run ID for uniqueness

  // Construct the curl command to push metrics to the Pushgateway
  // The --data-binary flag ensures the content is sent as-is, without processing
  // The /metrics/job/<job_name>/instance/<instance_name> path is standard for Pushgateway
  const curlCommand = `curl -X POST -H "Content-Type: text/plain" --data-binary "${metrics}" ${pushgatewayUrl}/metrics/job/${jobName}/instance/${instanceName}`;

  console.log('Attempting to push metrics to Pushgateway...');
  // Execute the curl command
  execSync(curlCommand, { stdio: 'inherit' }); // 'inherit' pipes stdout/stderr to the console
  console.log('Metrics pushed successfully!');

} catch (error) {
  console.error('Error processing test results or pushing to Pushgateway:', error);
  // Exit with a non-zero code to indicate failure in the workflow
  process.exit(1);
}
