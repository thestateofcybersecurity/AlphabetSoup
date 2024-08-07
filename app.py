from flask import Flask, request, jsonify
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
