from flask import Flask, request, jsonify

app = Flask(__name__)

# Example data source
acronyms = {
    "CISSP": {
        "definition": "Certified Information Systems Security Professional",
        "sources": [
            {"name": "Wikipedia", "url": "https://en.wikipedia.org/wiki/Certified_Information_Systems_Security_Professional"},
            {"name": "Official Site", "url": "https://www.isc2.org/Certifications/CISSP"}
        ]
    },
    "CEH": {
        "definition": "Certified Ethical Hacker",
        "sources": [
            {"name": "Wikipedia", "url": "https://en.wikipedia.org/wiki/Certified_Ethical_Hacker"},
            {"name": "Official Site", "url": "https://www.eccouncil.org/programs/certified-ethical-hacker-ceh/"}
        ]
    }
}

@app.route('/define', methods=['GET'])
def define_acronym():
    acronym = request.args.get('acronym', '').upper()
    result = acronyms.get(acronym, {"definition": "Not found", "sources": []})
    return jsonify(result)

if __name__ == '__main__':
    app.run(debug=True)
import json

app = Flask(__name__)

# Load the acronyms data from a JSON file
with open('acronyms.json') as f:
    acronyms = json.load(f)

@app.route('/define', methods=['GET'])
def define_acronym():
    acronym = request.args.get('acronym', '').upper()
    result = acronyms.get(acronym, {"definition": "Not found", "sources": []})
    return jsonify(result)

if __name__ == '__main__':
    app.run(debug=True)
