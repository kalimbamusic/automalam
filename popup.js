document.addEventListener('DOMContentLoaded', async () => {
  // Load stored data on popup open
  chrome.storage.local.get(['extractedHours'], (result) => {
    if (result.extractedHours) {
      displayResults(result.extractedHours);
    }
  });
});

document.getElementById('extractHours').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const targetUrl = 'https://smkb-sso.net.hilan.co.il/Hilannetv2/Attendance/calendarpage.aspx?isOnSelf=true';
    const homeUrl = 'https://smkb-sso.net.hilan.co.il/Hilannetv2/ng/personal-file/home';

    // Function to wait for navigation
    const waitForNavigation = (tabId) => {
      return new Promise(resolve => {
        chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });
    };

    // Function to check if the current URL matches the target URL
    const isTargetPage = (url) => {
      return url === targetUrl;
    };

    // Function to navigate to the target URL and handle redirects
    const navigateToTarget = async (tabId) => {
      let currentTab = await chrome.tabs.get(tabId);
      let attempts = 0;
      const maxAttempts = 3;

      while (!isTargetPage(currentTab.url) && attempts < maxAttempts) {
        if (currentTab.url === homeUrl) {
          console.log('Landed on home page, redirecting to target...');
        } else {
          console.log('Not on target page, redirecting...');
        }
        await chrome.tabs.update(tabId, { url: targetUrl });
        await waitForNavigation(tabId);
        currentTab = await chrome.tabs.get(tabId);
        attempts++;
        // Give the page a moment to fully load
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      if (!isTargetPage(currentTab.url)) {
        throw new Error('Failed to navigate to the target page after multiple attempts.');
      }
    };

    // Navigate to the target URL
    await navigateToTarget(tab.id);

    // Step 1: Select all relevant days
    console.log('Step 1: Selecting days...');
    const selectionResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: selectHilanDays
    });
    console.log('Selection completed:', selectionResult[0].result);

    // Step 2: Wait for a moment and click the "Selected Days" button
    console.log('Step 2: Clicking Selected Days button...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: clickSelectedDaysButton
    });

    // Step 3: Wait for the table to load and then extract data
    console.log('Step 3: Waiting for table and extracting data...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractDetailedHours
    });
    
    console.log('Extraction completed:', result[0].result);
    
    // Store the extracted data
    chrome.storage.local.set({ extractedHours: result[0].result });

    // Display results
    displayResults(result[0].result);
  } catch (error) {
    console.error('Error:', error);
    document.getElementById('result').textContent = 'Error: ' + error.message;
  }
});

document.getElementById('navigateToHRPortal').addEventListener('click', async () => {
  const CALENDAR_URL = 'https://hrm-portal.malam-payroll.com/timesheets/timesheets-report/calendar';
  const LOBBY_URL = 'https://hrm-portal.malam-payroll.com/lobby';
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // 1. Attempt direct navigation to calendar
  await chrome.tabs.update(tab.id, { url: CALENDAR_URL });
  
  // 2. Critical: Wait for page to fully stabilize
  await new Promise(resolve => {
    const onComplete = (updatedTabId, info) => {
      if (updatedTabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onComplete);
        setTimeout(resolve, 500); // Extra 500ms for JS execution
      }
    };
    chrome.tabs.onUpdated.addListener(onComplete);
  });

  // 3. Verify successful landing
  const currentTab = await chrome.tabs.get(tab.id);
  if (!currentTab.url.includes('timesheets-report')) {
    console.log('Direct navigation failed, trying lobby path...');
    await chrome.tabs.update(tab.id, { url: LOBBY_URL });
    await new Promise(resolve => setTimeout(resolve, 1500));
    await chrome.tabs.update(tab.id, { url: CALENDAR_URL });
  }
});

document.getElementById('checkHRPortalData').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: checkCalendarAndStorage
  });
});

async function checkCalendarAndStorage() {
  // Utility function to wait for an element
  async function waitForElement(selector, parent = document, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = parent.querySelector(selector);
      if (element) return element;
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms
    }
    throw new Error(`Element ${selector} not found within ${timeout}ms`);
  }

  // Utility function to get stored hours from Chrome storage
  function getStoredHours() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['extractedHours'], (result) => {
        resolve(result.extractedHours || {});
      });
    });
  }

  // Utility function to set a value in an input field
  async function setInputValue(selector, value) {
    const inputField = await waitForElement(selector, document, 5000);
    if (!inputField) {
      console.log(`Input field ${selector} not found.`);
      return;
    }

    inputField.focus();
    inputField.value = value;

    // Dispatch input and change events
    inputField.dispatchEvent(new Event('input', { bubbles: true }));
    inputField.dispatchEvent(new Event('change', { bubbles: true }));
    inputField.dispatchEvent(new Event('blur'));

    console.log(`Set value for ${selector}: ${value}`);
  }

  // Utility function to wait for a modal to close
  async function waitForModalClose() {
    return new Promise((resolve) => {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.removedNodes) {
            mutation.removedNodes.forEach((node) => {
              if (node.classList && node.classList.contains('report-form-wrapper__content')) {
                observer.disconnect();
                resolve();
              }
            });
          }
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });
  }

  // Utility function to wait for the calendar to stabilize after re-rendering
  async function waitForCalendarStabilization() {
    await waitForElement('div.cv-day:not(.cv-day-loading)', document, 5000);
  }

  // Utility function to check if date has existing report
  function hasExistingReport(dayElement) {
    return !!dayElement.querySelector('i[aria-label="דיווח ידני"]');
  }

  // Utility function to handle form submission for a single day
  async function processDay(dateClass, storedHours) {
    try {
      // Re-query the day element FRESHLY using the dateClass
      const daySelector = `div.cv-day.${dateClass}:not(.outsideOfMonth)`;
      const dayElement = await waitForElement(daySelector, document, 5000);
      if (!dayElement) {
        console.log(`Day element for ${dateClass} not found. Skipping.`);
        return;
      }

      // Skip if date already has a report
      if (hasExistingReport(dayElement)) {
        console.log(`Skipping ${dateClass} - already has report`);
        return;
      }

      if (!storedHours[dateClass]?.entrance || !storedHours[dateClass]?.exit) {
        console.log(`Skipping ${dateClass} - missing entrance/exit time`);
        return;
      }
      console.log('Clicking day:', dayElement);
      dayElement.click();

      // Wait for the modal to open (FRESHLY queried)
      const modal = await waitForElement('div.report-form-wrapper__content', document, 5000);

      // Check if form is fully loaded
      const addButton = await waitForElement('button:has(span.v-btn__content i.far.fa-plus)', document, 3000);
      addButton.click();

      // Set entrance and exit times
      if (storedHours[dateClass]?.entrance) {
        await setInputValue('input[aria-label="שעת כניסה"]', storedHours[dateClass].entrance);
      }
      if (storedHours[dateClass]?.exit) {
        await setInputValue('input[aria-label="שעת יציאה"]', storedHours[dateClass].exit);
      }

      // Save the form
      const saveButton = await waitForElement('button[data-cy="timesheets-save-report-btn"]', document, 5000);
      saveButton.click();
      console.log('Save button clicked. Waiting for toast...');

      // Wait for the toast and dismiss it
      await waitForToastAndDismiss();
      console.log('Toast handled.');


      // Wait for the calendar to stabilize after re-rendering
      await waitForCalendarStabilization();
    } catch (error) {
      console.error('Error processing day:', error);
    }
  }

  // Utility function to wait for toast and dismiss it
  async function waitForToastAndDismiss() {
    try {
      // Target the actual toast element structure we found
      const toast = await waitForElement(
        '.Toastify__toast--success', 
        document, 
        5000
      );
      
      // Wait for toast to fully appear
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Click the specific close button we found in the DOM
      const closeBtn = toast.querySelector('.payroll-toast__close-button');
      if (closeBtn) {
        closeBtn.click();
      } else {
        // Fallback to clicking the toast itself
        toast.click(); 
      }
      
      // Brief pause to let the dismissal animate
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.log('Toast already auto-dismissed or not found');
    }
  }

  // Main logic
  try {
    const storedHours = await getStoredHours();
    const dateClasses = Object.keys(storedHours);

    for (const dateClass of dateClasses) {
      // Process one date at a time, re-querying elements each iteration
      await processDay(dateClass, storedHours);
    }
  } catch (error) {
    console.error('Error in checkCalendarAndStorage:', error);
  }
}

function displayResults(data) {
  const resultDiv = document.getElementById('result');
  console.log('Raw data:', data);
  
  if (!data || Object.keys(data).length === 0) {
    resultDiv.textContent = 'No hours found. Debug info: ' + JSON.stringify(data);
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <tr>
      <th colspan="4" style="text-align: center; background-color: #f8f9fa;">${data[Object.keys(data)[0]].monthName} ${data[Object.keys(data)[0]].year}</th>
    </tr>
    <tr>
      <th>Date</th>
      <th>Entrance</th>
      <th>Exit</th>
      <th>Total</th>
    </tr>
    ${Object.entries(data).sort(([, a], [, b]) => {
      const dateA = parseInt(a.date.split('/')[0]);
      const dateB = parseInt(b.date.split('/')[0]);
      return dateA - dateB;
    }).map(([formattedDate, dayData]) => `
      <tr>
        <td>${dayData.date}</td>
        
        <td>${dayData.entrance || '-'}</td>
        <td>${dayData.exit || '-'}</td>
        <td>${dayData.total || '-'}</td>
      </tr>
    `).join('')}
  `;
  
  resultDiv.innerHTML = '';
  resultDiv.appendChild(table);
}

function selectHilanDays() {
  // Find all date cells
 const dateCells = document.querySelectorAll('td[class*="cDIES"]');
  let selectedCount = 0;

  dateCells.forEach(cell => {
    // Check if the cell has a valid time entry
    const timeCell = cell.querySelector('.cDM');
    const dateCell = cell.querySelector('.dTS');
    
    if (timeCell && timeCell.textContent.trim() !== '' && 
        dateCell && parseInt(dateCell.textContent.trim()) <= 31) {
      // If not already selected
      if (!cell.classList.contains('CSD')) {
        cell.click();
        selectedCount++;
      }
    }
  });

  return `Selected ${selectedCount} dates`;
}

function clickSelectedDaysButton() {
  const selectedDaysButton = document.getElementById('ctl00_mp_RefreshSelectedDays');
  if (selectedDaysButton) {
    console.log('Clicking selected days button');
    selectedDaysButton.click();
    return true;
  } else {
    console.error('Selected days button not found');
    return false;
  }
}

function extractDetailedHours() {
  const daysObject = {};
  
  // Extract year from the month selector
  const monthSelector = document.getElementById('ctl00_mp_calendar_monthChanged');
  const monthName = monthSelector?.textContent.replace(/\d{4}/, '').trim();
  console.log(monthName);
  const monthMap = { 'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6, 'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12 };
  const numericMonth = monthMap[monthName];
  console.log(numericMonth);
  const year = monthSelector?.textContent.match(/\d{4}/);
  
  // Get all rows from the detailed view
  const detailsTable = document.querySelector('table[id*="RG_Days_"]');
  if (!detailsTable) {
    console.error('Details table not found');
    return daysObject;
  }

  const rows = detailsTable.querySelectorAll('tr[id*="_row_"]');
  console.log('Found detail rows:', rows.length);
  
  rows.forEach((row, index) => {
    try {
      // Get all cells in the row
      const cells = row.getElementsByTagName('td');
      console.log(`Processing row ${index}:`, cells.length, 'cells');
      
      if (cells.length >= 4) {
        const date = cells[0]?.textContent?.trim();
        
        // Extract entrance time (from the third column)
        const entranceInput = cells[5]?.querySelector('input[id*="ManualEntry"]');
        const entrance = entranceInput?.value || cells[5]?.getAttribute('ov') || '';
        
        // Extract exit time (from the fourth column)
        const exitInput = cells[6]?.querySelector('input[id*="ManualExit"]');
        const exit = exitInput?.value || cells[6]?.getAttribute('ov') || '';
        
        // Extract total time (from the first column after date)
        const totalCell = cells[7];
        let total = '';
        
        if (totalCell) {
          // Try to get total from span first
          const totalSpan = totalCell.querySelector('span[class*="ROC"]');
          if (totalSpan) {
            total = totalSpan.textContent.trim();
          } else {
            // Fallback to cell's ov attribute
            total = totalCell.getAttribute('ov') || '';
          }
        }
        
        console.log('Row data:', { date, entrance, exit, total, year });
        
        if (date && parseInt(date) <= 31) {
          const cleanDate = date.replace(/[א-ת]/g, '').trim();
          const dateObj = new Date(parseInt(year), numericMonth - 1, parseInt(cleanDate));
          const formattedMonth = String(numericMonth).padStart(2, '0');
          console.log(year);
          const formattedDay = String(dateObj.getDate()).padStart(2, '0');
          const formattedDate = `d${year}-${formattedMonth}-${formattedDay}`;

          daysObject[formattedDate] = {
            date,
            entrance,
            exit,
            total,
            year,
            monthName
          };
        }
      }
    } catch (error) {
      console.error('Error processing row:', error);
    }
  });
  
  console.log('Extracted days:', daysObject);
  return daysObject;
}
