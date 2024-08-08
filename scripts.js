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
        displaySoupOfTheDay();
    } catch (error) {
        console.error('Error loading acronym data:', error);
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
        resultDiv.textContent = `No matches found for ${query}.`;
        }
    }
    return results;
}
    resultDiv.innerHTML = results.map(result => `
        <div>
            <h2>${result.acronym}</h2>
            <p>${result.definition}</p>
            <h3>Sources:</h3>
            <ul>
                ${result.sources.map(source => `<li><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.name)}</a></li>`).join('')}
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
document.getElementById('searchButton').addEventListener('click', getDefinition);

// Display Soup of the Day
function displaySoupOfTheDay() {
    const today = new Date().toISOString().slice(0, 10);
    let soupOfTheDay = JSON.parse(localStorage.getItem('soupOfTheDay'));

    if (!soupOfTheDay || soupOfTheDay.date !== today) {
        const acronyms = Object.keys(acronymData);
        const randomAcronym = acronyms[Math.floor(Math.random() * acronyms.length)];
        soupOfTheDay = {
            date: today,
            acronym: randomAcronym,
            definition: acronymData[randomAcronym].definition,
            sources: acronymData[randomAcronym].sources
        };
        localStorage.setItem('soupOfTheDay', JSON.stringify(soupOfTheDay));
    }

    const soupAcronym = document.getElementById('soupAcronym');
    soupAcronym.innerHTML = `<strong>${soupOfTheDay.acronym}</strong>: ${soupOfTheDay.definition}`;
}

// Load the acronym data when the page loads
window.onload = loadAcronymData;
