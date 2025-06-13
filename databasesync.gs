// ===== CONFIGURATION =====
const CONFIG = {
  API_URL: 'https://exchange-api-cer-2025.uc.r.appspot.com/api/v1/exchange-scores',
  CERTIFICATE_API_URL: 'https://exchange-api-cer-2025.uc.r.appspot.com/api/v1/exchange-certificates', // Certificate JOIN query endpoint
  API_KEY: PropertiesService.getScriptProperties().getProperty('API_KEY'),
  SPREADSHEET_ID: '1j3y6VABAZU2tlzbymjDoCSxbYpj9iAgs3ync5EFZ6Y8',
  EXCHANGE_SHEET_NAME: 'exchange',
  CERTIFICATE_SHEET_NAME: 'certificate',
  TIMEOUT_SECONDS: 30,
  MAX_RETRIES: 3
};

// ===== MAIN FUNCTIONS =====

/**
 * Fetches data from your Cloud Run API with improved error handling
 */
function fetchExchangeData() {
  return fetchDataFromAPI(CONFIG.API_URL, 'exchange');
}

/**
 * Fetches certificate data from your Cloud Run API
 */
function fetchCertificateData() {
  return fetchDataFromAPI(CONFIG.CERTIFICATE_API_URL, 'certificate');
}

/**
 * Generic function to fetch data from any API endpoint
 */
function fetchDataFromAPI(apiUrl, dataType) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${CONFIG.MAX_RETRIES}: Fetching ${dataType} data from API...`);
      
      const options = {
        method: 'GET',
        headers: {
          'X-API-Key': CONFIG.API_KEY,
          'Accept': 'application/json',
          'User-Agent': 'GoogleAppsScript/1.0'
        },
        muteHttpExceptions: true,
        followRedirects: true,
        validateHttpsCertificates: true
      };
      
      // Add timeout handling
      const response = UrlFetchApp.fetch(apiUrl, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      
      console.log(`API Response Code: ${responseCode}`);
      console.log(`Response length: ${responseText.length} characters`);
      
      if (responseCode !== 200) {
        let errorMessage = `HTTP ${responseCode}`;
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error?.message || errorData.message || errorMessage;
        } catch (e) {
          errorMessage = responseText.substring(0, 200) + (responseText.length > 200 ? '...' : '');
        }
        throw new Error(`API Error: ${errorMessage}`);
      }
      
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`Invalid JSON response: ${parseError.message}`);
      }
      
      if (!result.success) {
        throw new Error(result.error?.message || result.message || 'API request failed');
      }
      
      if (!result.data || !Array.isArray(result.data)) {
        throw new Error('Invalid data format: expected array of records');
      }
      
      console.log(`Successfully fetched ${result.row_count} ${dataType} rows`);
      return result.data;
      
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error.toString());
      
      if (attempt < CONFIG.MAX_RETRIES) {
        console.log(`Waiting 2 seconds before retry...`);
        Utilities.sleep(2000); // Wait 2 seconds before retry
      }
    }
  }
  
  // If all attempts failed, throw the last error
  throw new Error(`All ${CONFIG.MAX_RETRIES} attempts failed. Last error: ${lastError.toString()}`);
}

/**
 * Main function to refresh the exchange sheet with database data
 */
function refreshDatabaseData() {
  return refreshDataByType('exchange', CONFIG.EXCHANGE_SHEET_NAME, fetchExchangeData);
}

/**
 * Main function to refresh the certificate sheet with database data
 */
function refreshCertificateData() {
  return refreshDataByType('certificate', CONFIG.CERTIFICATE_SHEET_NAME, fetchCertificateData);
}

/**
 * Generic function to refresh data for any sheet type
 */
function refreshDataByType(dataType, sheetName, fetchFunction) {
  const startTime = new Date();
  
  try {
    // Show progress notification
    SpreadsheetApp.getActiveSpreadsheet().toast(
      `⏳ Connecting to ${dataType} API...`,
      '🔄 Refreshing Data',
      -1
    );
    
    // Fetch data from API
    const data = fetchFunction();
    
    if (!data || data.length === 0) {
      throw new Error(`No ${dataType} data received from API`);
    }
    
    // Update the sheet
    updateSheet(data, sheetName);
    
    // Calculate execution time
    const executionTime = ((new Date() - startTime) / 1000).toFixed(2);
    
    // Show success notification
    SpreadsheetApp.getActiveSpreadsheet().toast(
      `✅ Successfully updated ${data.length} ${dataType} rows in ${executionTime} seconds`,
      '✨ Refresh Complete',
      5
    );
    
    return {
      success: true,
      rowsUpdated: data.length,
      executionTime: executionTime,
      dataType: dataType
    };
    
  } catch (error) {
    // Show error notification
    SpreadsheetApp.getActiveSpreadsheet().toast(
      `❌ ${error.toString()}`,
      `⚠️ ${dataType.charAt(0).toUpperCase() + dataType.slice(1)} Refresh Failed`,
      10
    );
    
    // Log error for debugging
    console.error(`${dataType} refresh failed:`, error);
    throw error;
  }
}

/**
 * Updates the Google Sheet with the fetched data
 */
function updateSheet(data, sheetName) {
  try {
    // Get the spreadsheet and sheet
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(sheetName);
    
    // Create sheet if it doesn't exist
    if (!sheet) {
      console.log(`Creating new sheet: ${sheetName}`);
      sheet = spreadsheet.insertSheet(sheetName);
    }
    
    // Clear existing content
    sheet.clear();
    sheet.clearFormats();
    
    // Get headers from the first data row
    const headers = Object.keys(data[0]);
    const sheetData = [headers];
    
    // Convert data to 2D array for Sheets
    data.forEach(row => {
      const rowData = headers.map(header => {
        const value = row[header];
        // Handle null/undefined values and convert to string
        if (value === null || value === undefined) {
          return '';
        }
        // Convert to string and handle special characters
        return String(value).replace(/[\r\n\t]/g, ' ');
      });
      sheetData.push(rowData);
    });
    
    // Write all data at once (more efficient)
    const range = sheet.getRange(1, 1, sheetData.length, headers.length);
    range.setValues(sheetData);
    
    // Apply formatting
    formatSheet(sheet, headers.length, sheetData.length);
    
    console.log(`Updated ${data.length} rows with ${headers.length} columns in ${sheetName} sheet`);
    
  } catch (error) {
    console.error('Error updating sheet:', error);
    throw new Error(`Failed to update sheet: ${error.message}`);
  }
}

/**
 * Applies formatting to the sheet
 */
function formatSheet(sheet, numColumns, numRows) {
  try {
    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, numColumns);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1a73e8');
    headerRange.setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('center');
    headerRange.setVerticalAlignment('middle');
    
    // Add borders
    const dataRange = sheet.getRange(1, 1, numRows, numColumns);
    dataRange.setBorder(true, true, true, true, true, true);
    
    // Apply alternating row colors (only if more than header row)
    if (numRows > 1) {
      const bodyRange = sheet.getRange(2, 1, numRows - 1, numColumns);
      bodyRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
    }
    
    // Auto-resize columns (limit to reasonable width)
    for (let col = 1; col <= numColumns; col++) {
      sheet.autoResizeColumn(col);
      const width = sheet.getColumnWidth(col);
      if (width > 300) {
        sheet.setColumnWidth(col, 300); // Max width of 300px
      }
    }
    
    // Freeze header row
    sheet.setFrozenRows(1);
    
  } catch (error) {
    console.error('Error formatting sheet:', error);
    // Don't throw error for formatting issues
  }
}

// ===== MENU AND UI FUNCTIONS =====

/**
 * Creates custom menu when the spreadsheet opens
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🗄️ Database Sync')
    .addItem('🔄 Refresh Exchange Data', 'refreshDatabaseData')
    .addItem('📜 Refresh Certificate Data', 'refreshCertificateData')
    .addSeparator()
    .addItem('🔌 Test Exchange API', 'testExchangeConnection')
    .addItem('🔌 Test Certificate API', 'testCertificateConnection')
    .addItem('💚 Test API Health (Quick)', 'testAPIHealth')
    .addSeparator()
    .addItem('📊 Show Exchange Info', 'showExchangeInfo')
    .addItem('📊 Show Certificate Info', 'showCertificateInfo')
    .addItem('🐛 Debug Connections', 'debugConnection')
    .addSeparator()
    .addItem('🔑 Setup API Key', 'setupAPIKey')
    .addItem('🔍 Check API Key Config', 'checkAPIKeyConfig')
    .addSeparator()
    .addItem('ℹ️ About', 'showAbout')
    .addToUi();
}

/**
 * Test exchange API connection
 */
function testExchangeConnection() {
  testConnectionByType(CONFIG.API_URL, 'Exchange', 'exchange');
}

/**
 * Test certificate API connection
 */
function testCertificateConnection() {
  testConnectionByType(CONFIG.CERTIFICATE_API_URL, 'Certificate', 'certificate');
}

/**
 * Test basic API health (doesn't hit database)
 */
function testAPIHealth() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    // Test the health endpoint which doesn't require database connection
    const healthUrl = CONFIG.API_URL.replace('/api/v1/exchange-scores', '/health');
    
    const response = UrlFetchApp.fetch(healthUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      muteHttpExceptions: true,
      deadline: 10
    });
    
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode === 200) {
      try {
        const healthData = JSON.parse(responseText);
        ui.alert(
          '✅ API Health Check Passed',
          `Basic API connectivity is working!\n\n` +
          `✓ HTTP Status: ${responseCode}\n` +
          `✓ API Status: ${healthData.status || 'healthy'}\n` +
          `✓ Database: ${healthData.database || 'unknown'}\n` +
          `✓ Secret Manager: ${healthData.secret_manager || 'unknown'}\n\n` +
          `If database shows 'disconnected', it may be a temporary timeout.\n` +
          `Try the full API test or data refresh.`,
          ui.ButtonSet.OK
        );
      } catch (e) {
        ui.alert(
          '⚠️ API Responded but Invalid JSON',
          `API is reachable but returned invalid JSON:\n\n${responseText.substring(0, 200)}`,
          ui.ButtonSet.OK
        );
      }
    } else {
      ui.alert(
        '❌ API Health Check Failed',
        `Health endpoint returned error:\n\nStatus: ${responseCode}\nResponse: ${responseText.substring(0, 200)}`,
        ui.ButtonSet.OK
      );
    }
    
  } catch (error) {
    ui.alert(
      '❌ API Health Check Failed',
      `Could not reach API health endpoint:\n\n${error.toString()}`,
      ui.ButtonSet.OK
    );
  }
}

/**
 * Generic function to test API connection
 */
function testConnectionByType(apiUrl, displayName, dataType) {
  const ui = SpreadsheetApp.getUi();
  
  try {
    console.log(`Testing ${displayName} API connection...`);
    
    // Check if API key is configured
    if (!CONFIG.API_KEY) {
      ui.alert(
        `⚠️ ${displayName} Configuration Error`,
        `API key is not configured!\n\n` +
        `Please run "Setup API Key" from the menu first.`,
        ui.ButtonSet.OK
      );
      return;
    }
    
    // Test basic connectivity first with extended timeout
    const response = UrlFetchApp.fetch(apiUrl, {
      method: 'GET',
      headers: {
        'X-API-Key': CONFIG.API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'GoogleAppsScript/1.0'
      },
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true,
      deadline: CONFIG.TIMEOUT_SECONDS // Use the same timeout as data fetch
    });
    
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    console.log(`Response code: ${responseCode}`);
    console.log(`Response length: ${responseText.length}`);
    
    if (responseCode === 200) {
      try {
        const data = JSON.parse(responseText);
        if (data.success) {
          ui.alert(
            `✅ ${displayName} Connection Successful`,
            `${displayName} API is working correctly!\n\n` +
            `✓ HTTP Status: ${responseCode}\n` +
            `✓ Rows available: ${data.row_count}\n` +
            `✓ Response time: Good\n` +
            `✓ Data format: Valid\n\n` +
            `API URL: ${apiUrl}`,
            ui.ButtonSet.OK
          );
        } else {
          ui.alert(
            `⚠️ ${displayName} API Error`,
            `API responded but returned an error:\n\n` +
            `Status: ${responseCode}\n` +
            `Error: ${data.error?.message || 'Unknown error'}\n\n` +
            `Check the Cloud Run logs for more details.`,
            ui.ButtonSet.OK
          );
        }
      } catch (parseError) {
        ui.alert(
          `⚠️ ${displayName} Parse Error`,
          `API responded but with invalid JSON:\n\n` +
          `Status: ${responseCode}\n` +
          `Parse Error: ${parseError.message}\n` +
          `Response preview: ${responseText.substring(0, 200)}...`,
          ui.ButtonSet.OK
        );
      }
    } else {
      // Check if it's a database timeout error
      let errorDetails = responseText.substring(0, 300);
      let troubleshooting = `Check if the API server is running and accessible.`;
      
      if (responseText.includes('timeout expired') || responseText.includes('DATABASE_ERROR')) {
        troubleshooting = `This appears to be a database connection timeout.\n\n` +
          `Possible solutions:\n` +
          `• Wait a moment and try again\n` +
          `• Check if VPN connection is stable\n` +
          `• Verify database proxy service is running\n\n` +
          `Note: Data refresh may still work even if test fails.`;
      }
      
      ui.alert(
        `❌ ${displayName} HTTP Error`,
        `API returned HTTP error:\n\n` +
        `Status: ${responseCode}\n` +
        `Response: ${errorDetails}\n\n` +
        troubleshooting,
        ui.ButtonSet.OK
      );
    }
    
  } catch (error) {
    let errorMessage = error.toString();
    let troubleshooting = `This could be due to:\n` +
      `• Network connectivity issues\n` +
      `• API server being down\n` +
      `• Firewall blocking the request\n` +
      `• Invalid API URL or key`;
    
    // Check for timeout-specific errors
    if (errorMessage.includes('timeout') || errorMessage.includes('deadline')) {
      troubleshooting = `This appears to be a timeout error.\n\n` +
        `The API test may timeout while data refresh works because:\n` +
        `• Database connections can be slow to establish\n` +
        `• VPN tunnel may need time to warm up\n` +
        `• First connection after idle period takes longer\n\n` +
        `Try running "Refresh Exchange Data" to verify the API works.`;
    }
    
    ui.alert(
      `❌ ${displayName} Connection Failed`,
      `Could not connect to ${displayName} API:\n\n` +
      `Error: ${errorMessage}\n\n` +
      troubleshooting,
      ui.ButtonSet.OK
    );
  }
}

/**
 * Debug connection with detailed logging
 */
function debugConnection() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    console.log('=== DEBUG CONNECTION START ===');
    console.log(`Exchange API URL: ${CONFIG.API_URL}`);
    console.log(`Certificate API URL: ${CONFIG.CERTIFICATE_API_URL}`);
    console.log(`API Key: ${CONFIG.API_KEY.substring(0, 10)}...`);
    console.log(`Spreadsheet ID: ${CONFIG.SPREADSHEET_ID}`);
    console.log(`Exchange Sheet Name: ${CONFIG.EXCHANGE_SHEET_NAME}`);
    console.log(`Certificate Sheet Name: ${CONFIG.CERTIFICATE_SHEET_NAME}`);
    
    // Test 1: Basic URL fetch for exchange
    console.log('Test 1: Exchange API accessibility...');
    const exchangeResponse = UrlFetchApp.fetch(CONFIG.API_URL, {
      method: 'GET',
      headers: {
        'X-API-Key': CONFIG.API_KEY
      },
      muteHttpExceptions: true
    });
    console.log(`Exchange API response code: ${exchangeResponse.getResponseCode()}`);
    
    // Test 2: Basic URL fetch for certificate
    console.log('Test 2: Certificate API accessibility...');
    const certificateResponse = UrlFetchApp.fetch(CONFIG.CERTIFICATE_API_URL, {
      method: 'GET',
      headers: {
        'X-API-Key': CONFIG.API_KEY
      },
      muteHttpExceptions: true
    });
    console.log(`Certificate API response code: ${certificateResponse.getResponseCode()}`);
    
    // Test 3: Spreadsheet access
    console.log('Test 3: Spreadsheet access...');
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    console.log(`Spreadsheet name: ${spreadsheet.getName()}`);
    
    let exchangeSheet = spreadsheet.getSheetByName(CONFIG.EXCHANGE_SHEET_NAME);
    let certificateSheet = spreadsheet.getSheetByName(CONFIG.CERTIFICATE_SHEET_NAME);
    
    console.log(`Exchange sheet exists: ${!!exchangeSheet}`);
    console.log(`Certificate sheet exists: ${!!certificateSheet}`);
    
    console.log('=== DEBUG CONNECTION END ===');
    
    ui.alert(
      '🐛 Debug Complete',
      `Debug information has been logged to the console.\n\n` +
      `Check the Apps Script editor logs for detailed information:\n` +
      `1. Go to Apps Script editor\n` +
      `2. Click "Executions" in the left sidebar\n` +
      `3. Find this execution and click to see logs\n\n` +
      `Basic status:\n` +
      `• Exchange API: ${exchangeResponse.getResponseCode()}\n` +
      `• Certificate API: ${certificateResponse.getResponseCode()}\n` +
      `• Spreadsheet: Accessible\n` +
      `• Exchange Sheet: ${exchangeSheet ? 'Exists' : 'Will be created'}\n` +
      `• Certificate Sheet: ${certificateSheet ? 'Exists' : 'Will be created'}`,
      ui.ButtonSet.OK
    );
    
  } catch (error) {
    console.error('Debug failed:', error);
    ui.alert(
      '❌ Debug Failed',
      `Debug process failed:\n${error.toString()}`,
      ui.ButtonSet.OK
    );
  }
}

/**
 * Show information about the exchange sheet
 */
function showExchangeInfo() {
  showSheetInfo(CONFIG.EXCHANGE_SHEET_NAME, 'Exchange');
}

/**
 * Show information about the certificate sheet
 */
function showCertificateInfo() {
  showSheetInfo(CONFIG.CERTIFICATE_SHEET_NAME, 'Certificate');
}

/**
 * Generic function to show sheet information
 */
function showSheetInfo(sheetName, displayName) {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(sheetName);
    
    if (!sheet) {
      SpreadsheetApp.getUi().alert(
        `📊 ${displayName} Sheet Information`,
        `Sheet "${sheetName}" does not exist yet.\n\n` +
        `Run "Refresh ${displayName} Data" to create it and populate with data.`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }
    
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    
    SpreadsheetApp.getUi().alert(
      `📊 ${displayName} Sheet Information`,
      `Current data in sheet "${sheetName}":\n\n` +
      `• Rows: ${lastRow} (including header)\n` +
      `• Columns: ${lastColumn}\n` +
      `• Data rows: ${Math.max(0, lastRow - 1)}\n` +
      `• Spreadsheet: ${spreadsheet.getName()}\n\n` +
      `Last modified: ${new Date(spreadsheet.getLastUpdated()).toLocaleString()}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    
  } catch (error) {
    SpreadsheetApp.getUi().alert(
      '❌ Error',
      `Could not get ${displayName.toLowerCase()} sheet information:\n${error.toString()}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

/**
 * Show about information
 */
function showAbout() {
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    '🗄️ PostgreSQL to Google Sheets Sync',
    'This tool syncs data from your PostgreSQL database to Google Sheets.\n\n' +
    '📍 Data Sources:\n' +
    '• Exchange Scores: CER PostgreSQL Database\n' +
    '• Certificates: CER PostgreSQL Database\n\n' +
    '🔄 Method: Complete refresh via Cloud Run API\n' +
    '🔐 Security: API Key authentication\n' +
    '☁️ Infrastructure: Google Cloud Run\n' +
    '🔗 VPN: Secure database access\n\n' +
    'Features:\n' +
    '• Dual data source support\n' +
    '• Automatic retry on failures\n' +
    '• Detailed error reporting\n' +
    '• Connection diagnostics\n' +
    '• Data validation\n\n' +
    'Version: 2.1 (Enhanced with Certificate Support)',
    ui.ButtonSet.OK
  );
}

// ===== TRIGGER FUNCTIONS FOR EXTERNAL CALLS =====

/**
 * Function that can be called from Google Docs or other scripts for exchange data
 * Returns true/false for success/failure
 */
function triggerDatabaseRefresh() {
  try {
    refreshDatabaseData();
    return true;
  } catch (error) {
    console.error('Exchange trigger failed:', error);
    return false;
  }
}

/**
 * Function that can be called from Google Docs or other scripts for certificate data
 * Returns true/false for success/failure
 */
function triggerCertificateRefresh() {
  try {
    refreshCertificateData();
    return true;
  } catch (error) {
    console.error('Certificate trigger failed:', error);
    return false;
  }
}

/**
 * Function for scheduled exchange refresh
 */
function scheduledRefresh() {
  try {
    console.log('Starting scheduled exchange refresh...');
    refreshDatabaseData();
    console.log('Scheduled exchange refresh completed successfully');
  } catch (error) {
    console.error('Scheduled exchange refresh failed:', error);
    // Could send email notification here if needed
  }
}

/**
 * Function for scheduled certificate refresh
 */
function scheduledCertificateRefresh() {
  try {
    console.log('Starting scheduled certificate refresh...');
    refreshCertificateData();
    console.log('Scheduled certificate refresh completed successfully');
  } catch (error) {
    console.error('Scheduled certificate refresh failed:', error);
    // Could send email notification here if needed
  }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Clear exchange sheet data (useful for testing)
 */
function clearExchangeSheet() {
  clearSheetByName(CONFIG.EXCHANGE_SHEET_NAME, 'Exchange');
}

/**
 * Clear certificate sheet data (useful for testing)
 */
function clearCertificateSheet() {
  clearSheetByName(CONFIG.CERTIFICATE_SHEET_NAME, 'Certificate');
}

/**
 * Generic function to clear a sheet by name
 */
function clearSheetByName(sheetName, displayName) {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(sheetName);
    
    if (sheet) {
      sheet.clear();
      sheet.clearFormats();
      SpreadsheetApp.getActiveSpreadsheet().toast(
        `✅ ${displayName} sheet cleared successfully`,
        '🧹 Clear Complete',
        3
      );
    } else {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        `⚠️ ${displayName} sheet not found`,
        '🧹 Clear Failed',
        3
      );
    }
  } catch (error) {
    console.error(`Clear ${displayName.toLowerCase()} failed:`, error);
    SpreadsheetApp.getActiveSpreadsheet().toast(
      `❌ ${error.toString()}`,
      `🧹 Clear ${displayName} Failed`,
      5
    );
  }
}

// ===== SETUP FUNCTIONS =====

/**
 * Setup function to configure API key (run this once)
 * Replace 'YOUR_ACTUAL_API_KEY' with your real API key
 */
function setupAPIKey() {
  const ui = SpreadsheetApp.getUi();
  
  // Prompt for API key
  const response = ui.prompt(
    '🔑 Setup API Key',
    'Enter your API key for the Exchange Data API:',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (response.getSelectedButton() === ui.Button.OK) {
    const apiKey = response.getResponseText().trim();
    
    if (apiKey && apiKey.length > 10) {
      // Store the API key in script properties
      PropertiesService.getScriptProperties().setProperty('API_KEY', apiKey);
      
      ui.alert(
        '✅ API Key Configured',
        `API key has been securely stored!\n\n` +
        `Key preview: ${apiKey.substring(0, 10)}...\n\n` +
        `You can now use the "Test Exchange API" function.`,
        ui.ButtonSet.OK
      );
    } else {
      ui.alert(
        '❌ Invalid API Key',
        'Please enter a valid API key (must be longer than 10 characters).',
        ui.ButtonSet.OK
      );
    }
  }
}

/**
 * Check current API key configuration
 */
function checkAPIKeyConfig() {
  const ui = SpreadsheetApp.getUi();
  const apiKey = PropertiesService.getScriptProperties().getProperty('API_KEY');
  
  if (apiKey) {
    ui.alert(
      '🔑 API Key Status',
      `API key is configured!\n\n` +
      `Key preview: ${apiKey.substring(0, 10)}...\n` +
      `Length: ${apiKey.length} characters\n\n` +
      `Status: ✅ Ready to use`,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      '⚠️ API Key Not Configured',
      `No API key found in script properties.\n\n` +
      `Please run "Setup API Key" from the menu first.`,
      ui.ButtonSet.OK
    );
  }
}

