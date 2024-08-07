// scripts.js

let acronymData = {};

// Load acronym data from acronyms.json
async function loadAcronymData() {
    try {
        console.log('Fetching acronym data...');
        const response = await fetch('acronyms.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        acronymData = await response.json();
        console.log('Acronym data loaded:', acronymData);
    } catch (error) {
        console.error('Error loading acronym data:', error);
        alert(`Error loading acronym data: ${error.message}. Please try again later.`);
    }
}

// Sanitize user input to prevent XSS
function sanitizeHTML(str) {
    var temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

// Get definition of the entered acronym
async function getDefinition() {
    const acronym = sanitizeHTML(document.getElementById('acronym').value.trim().toUpperCase());
    if (!acronym || !isValidInput(acronym)) {
        alert('Please enter a valid acronym.');
        return;
    }
    const results = findMatchingAcronyms(acronym);
    displayResults(acronym, results);
}

// Validate input to allow only alphanumeric characters, spaces, and hyphens
function isValidInput(input) {
    const regex = /^[a-zA-Z0-9\s\-]+$/;
    return regex.test(input);
}

// Find matching acronyms
function findMatchingAcronyms(query) {
    const results = [];
    for (const key in acronymData) {
        if (key.includes(query)) {
            results.push({ acronym: key, ...acronymData[key] });
        }
    }
    return results;
}

// Display search results
function displayResults(query, results) {
    const resultDiv = document.getElementById('result');
    if (results.length === 0) {
        resultDiv.innerHTML = `<p>No matches found for <strong>${query}</strong>.</p>`;
        return;
    }
    resultDiv.innerHTML = results.map(result => `
        <div>
            <h2>${result.acronym}</h2>
            <p>${result.definition}</p>
            <h3>Sources:</h3>
            <ul>
                ${result.sources.map(source => `<li><a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.name}</a></li>`).join('')}
            </ul>
        </div>
    `).join('');
}

// Trigger search on Enter key press
function checkEnter(event) {
    if (event.key === 'Enter') {
        getDefinition();
    }
}

document.getElementById('acronym').addEventListener('keypress', checkEnter);

// Load the acronym data when the page loads
window.onload = loadAcronymData;
