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
    resultDiv.textContent = ''; // Clear any previous results

    if (results.length === 0) {
        const noMatch = document.createElement('p');
        noMatch.textContent = `No matches found for ${query}.`;
        resultDiv.appendChild(noMatch);
        return;
    }

    results.forEach(result => {
        const resultContainer = document.createElement('div');

        const acronymElement = document.createElement('h2');
        acronymElement.textContent = result.acronym;
        resultContainer.appendChild(acronymElement);

        const definitionElement = document.createElement('p');
        definitionElement.textContent = result.definition;
        resultContainer.appendChild(definitionElement);

        const sourcesHeader = document.createElement('h3');
        sourcesHeader.textContent = 'Sources:';
        resultContainer.appendChild(sourcesHeader);

        const sourcesList = document.createElement('ul');
        result.sources.forEach(source => {
            const listItem = document.createElement('li');
            const link = document.createElement('a');
            link.href = source.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = source.name;
            listItem.appendChild(link);
            sourcesList.appendChild(listItem);
        });
        resultContainer.appendChild(sourcesList);

        resultDiv.appendChild(resultContainer);
    });
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
    
    // Clear any previous content
    soupAcronym.textContent = '';

    // Create the elements safely
    const strongElement = document.createElement('strong');
    strongElement.textContent = soupOfTheDay.acronym;
    soupAcronym.appendChild(strongElement);

    const textNode = document.createTextNode(`: ${soupOfTheDay.definition}`);
    soupAcronym.appendChild(textNode);
}

// Load the acronym data when the page loads
window.onload = loadAcronymData;
