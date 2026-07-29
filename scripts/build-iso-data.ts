/**
 * Builds src/data/iso-27001.json.
 *
 * ISO/IEC 27001 is a copyrighted standard. Nothing from it is reproduced here:
 * no control text, no Annex A titles. What this file holds is the control
 * *identifier*, which is a factual reference, plus an original subject line
 * written for this site describing what the control is about in plain English.
 * The authoritative wording stays behind a link to ISO.
 *
 * The structure (four themes, 93 controls) was corroborated two ways before
 * being relied on: the widely published control count, and a check that all 78
 * ISO identifiers already curated in crosswalk.json fall inside these ranges.
 * A.6 and A.8 in particular have curated identifiers landing exactly on their
 * assumed maxima (A.6.8 and A.8.34), which would be a coincidence if the
 * boundaries were wrong.
 *
 * Run: npx tsx scripts/build-iso-data.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Theme {
  code: string;
  name: string;
  blurb: string;
  /** Original subject lines, one per control, in identifier order. */
  subjects: string[];
}

const THEMES: Theme[] = [
  {
    code: '5',
    name: 'Organizational',
    blurb:
      'The controls that decide how security is governed: who owns it, what the rules are, and how the organization holds itself and its suppliers to them.',
    subjects: [
      'Written security policies, approved and kept current',
      'Named security roles and the authority that comes with them',
      'Separating duties so no one person can act unchecked',
      'Management actively backing the security program',
      'Working relationships with regulators and law enforcement',
      'Membership of industry and peer security groups',
      'Gathering and acting on threat intelligence',
      'Security built into projects from the start',
      'Knowing what information and assets exist and who owns them',
      'Rules for handling assets acceptably',
      'Returning assets when an engagement ends',
      'Classifying information by how sensitive it is',
      'Labelling information so its classification is visible',
      'Controlling how information is transferred',
      'Deciding who may access what, on what basis',
      'Managing identities through their whole life',
      'Issuing and protecting authentication credentials',
      'Granting, reviewing, and withdrawing access rights',
      'Security in the relationship with each supplier',
      'Security terms written into supplier agreements',
      'Managing risk across the technology supply chain',
      'Monitoring supplier service delivery and change',
      'Security expectations for cloud services',
      'Planning and preparing for incident response',
      'Assessing events and deciding what is an incident',
      'Responding to incidents once declared',
      'Learning from incidents so they do not repeat',
      'Collecting and preserving evidence',
      'Keeping security working through disruption',
      'Recovery expectations built into continuity planning',
      'Identifying legal, regulatory, and contractual obligations',
      'Protecting intellectual property rights',
      'Protecting records against loss and falsification',
      'Protecting personal data and privacy',
      'Independent review of the security program',
      'Checking compliance with policies and standards',
      'Documented operating procedures for security tasks',
    ],
  },
  {
    code: '6',
    name: 'People',
    blurb:
      'The controls that address the human side: who is hired, what they agree to, what they are taught, and what happens when they leave.',
    subjects: [
      'Screening candidates before they are trusted with access',
      'Security responsibilities set out in employment terms',
      'Security awareness, education, and training',
      'A disciplinary process for security violations',
      'Responsibilities that survive the end of employment',
      'Confidentiality and non-disclosure agreements',
      'Security expectations for remote working',
      'A route for reporting security events',
    ],
  },
  {
    code: '7',
    name: 'Physical',
    blurb:
      'The controls that keep people away from equipment and information they should not reach, and protect that equipment from its surroundings.',
    subjects: [
      'Defining the physical boundary to be protected',
      'Controlling entry at that boundary',
      'Securing offices, rooms, and facilities',
      'Monitoring physical premises',
      'Protecting against physical and environmental threats',
      'Working securely in secure areas',
      'Clear desk and clear screen expectations',
      'Siting and protecting equipment',
      'Protecting assets taken off the premises',
      'Managing storage media through their life',
      'Protecting supporting utilities such as power',
      'Protecting cabling from interception and damage',
      'Maintaining equipment so it stays reliable',
      'Secure disposal or reuse of equipment',
    ],
  },
  {
    code: '8',
    name: 'Technological',
    blurb:
      'The controls implemented in and around the technology itself: endpoints, access, networks, software, and the data moving between them.',
    subjects: [
      'Protecting the endpoints people work from',
      'Restricting and managing privileged access',
      'Restricting access to information itself',
      'Controlling access to source code',
      'Authenticating securely before access is granted',
      'Managing capacity so systems stay available',
      'Defending against malware',
      'Managing technical vulnerabilities',
      'Managing configuration and preventing drift',
      'Deleting information when it is no longer needed',
      'Masking data so exposure is limited',
      'Preventing data from leaking out',
      'Backing up information and proving it restores',
      'Building redundancy into information processing',
      'Logging what happens on systems',
      'Monitoring for activity that should not be there',
      'Synchronizing clocks so events can be correlated',
      'Restricting use of privileged utility programs',
      'Controlling software installed on operational systems',
      'Securing networks and the services on them',
      'Securing individual network services',
      'Segregating networks from one another',
      'Filtering access to external web content',
      'Using cryptography and managing keys',
      'Security built into the development lifecycle',
      'Security requirements defined for applications',
      'Secure architecture and engineering principles',
      'Writing code securely',
      'Security testing during development and acceptance',
      'Managing security when development is outsourced',
      'Separating development, test, and production',
      'Managing change to systems and software',
      'Protecting information used for testing',
      'Protecting systems during audit activity',
    ],
  },
];

const EXPECTED: Record<string, number> = { '5': 37, '6': 8, '7': 14, '8': 34 };

const path = fileURLToPath(new URL('../src/data/iso-27001.json', import.meta.url));

/**
 * Metaphor and translation are hand-written per control and live only in the
 * JSON. Re-running this script must carry them across rather than blank them,
 * so the structural check stays runnable without costing the content.
 */
const existing = (() => {
  try {
    const prev = JSON.parse(readFileSync(path, 'utf8')) as {
      controls: { id: string; metaphor?: string; translation?: string }[];
    };
    return new Map(prev.controls.map((c) => [c.id, c]));
  } catch {
    return new Map<string, { metaphor?: string; translation?: string }>();
  }
})();

const controls = THEMES.flatMap((theme) => {
  if (theme.subjects.length !== EXPECTED[theme.code]) {
    throw new Error(
      `A.${theme.code} has ${theme.subjects.length} subjects, expected ${EXPECTED[theme.code]}`,
    );
  }
  return theme.subjects.map((subject, i) => {
    const id = `A.${theme.code}.${i + 1}`;
    const prev = existing.get(id);
    return {
      id,
      theme: theme.code,
      themeName: theme.name,
      subject,
      metaphor: prev?.metaphor ?? '',
      translation: prev?.translation ?? '',
    };
  });
});

const blank = controls.filter((c) => !c.metaphor || !c.translation).map((c) => c.id);
if (blank.length > 0) {
  console.warn(`Warning: ${blank.length} controls have no metaphor or translation: ${blank.join(', ')}`);
}

const total = Object.values(EXPECTED).reduce((a, b) => a + b, 0);
if (controls.length !== total) throw new Error(`built ${controls.length}, expected ${total}`);

const out = {
  meta: {
    name: 'ISO/IEC 27001:2022 Annex A',
    short: 'ISO 27001',
    officialUrl: 'https://www.iso.org/standard/27001',
    controlCount: total,
    note:
      'ISO/IEC 27001 is a copyrighted standard. No control text or Annex A title from it is reproduced here. Each entry holds the control identifier, which is a factual reference, and an original subject line written for this site. Consult the standard itself for authoritative wording.',
    themes: THEMES.map((t) => ({
      code: t.code,
      name: t.name,
      blurb: t.blurb,
      count: t.subjects.length,
    })),
  },
  controls,
};

writeFileSync(path, `${JSON.stringify(out, null, 1)}\n`);
console.log(`Wrote ${controls.length} ISO controls across ${THEMES.length} themes.`);
