import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { Presentation, PresentationFile } = await import(pathToFileURL(require.resolve('@oai/artifact-tool')));
const stats = JSON.parse(await fs.readFile(path.join(root, 'artifacts/evaluation.json'), 'utf8'));
const staging = path.resolve(process.env.TERMFOLIO_DECK_STAGE || path.join(root, '.build', 'presentation'));
const final = path.resolve(process.env.TERMFOLIO_DECK_OUTPUT || path.join(root, 'presentation', 'Termfolio - Group 9.pptx'));
const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

const c = { cream: '#FFF8F4', white: '#FFFFFF', ink: '#281B32', aubergine: '#56314F',
  muted: '#674D62', peach: '#F1B28D', blush: '#F8E3E7', light: '#FAEFED' };
const font = { display: 'Trebuchet MS', body: 'Verdana' };
const noLine = { fill: 'none', width: 0 };
const roster = [
  ['Shreyansh Vaibhav', '2401201094'], ['Tushar Kataria', '2401201083'],
  ['Nandini Kumari', '2401201085'], ['Harsh Nagal', '2401201089'],
  ['Dipesh Singh', '2401201091'], ['Tanish Sabharwal', '2401201096'],
];

function shape(page, x, y, width, height, fill, geometry = 'rect') {
  return page.shapes.add({ geometry, position: { left: x, top: y, width, height }, fill, line: noLine });
}

function text(page, value, x, y, width, height, options = {}) {
  const item = page.shapes.add({ name: value.split('\n')[0].slice(0, 90), geometry: 'textbox',
    position: { left: x, top: y, width, height }, fill: 'none', line: noLine });
  item.text = value;
  item.text.style = { typeface: options.face || font.body, fontSize: options.size || 21,
    color: options.color || c.ink, bold: options.bold || false, verticalAlignment: options.anchor || 'middle',
    alignment: options.align || 'left', wrap: options.wrap ? 'square' : 'none', autoFit: 'none', insets: 0 };
  return item;
}

function display(page, value, x, y, width, height, options = {}) {
  return text(page, value, x, y, width, height, { face: font.display, bold: true, size: 57, ...options });
}

function slide(background = c.cream) {
  const page = deck.slides.add();
  page.background.fill = background;
  return page;
}

function title(page, value, number) {
  shape(page, 64, 64, 32, 8, c.peach);
  display(page, value, 62, 83, 1148, 88);
  text(page, String(number).padStart(2, '0'), 1158, 664, 56, 24, { size: 13, color: c.muted, align: 'right' });
}

function notes(page, value) {
  page.speakerNotes.text = value;
}

{
  const page = slide(c.ink);
  shape(page, 744, 0, 536, 720, c.blush);
  shape(page, 60, 82, 42, 9, c.peach);
  text(page, 'NLP CAPSTONE / PROJECT 4', 60, 100, 630, 42, { color: c.white, size: 17 });
  display(page, 'Keyword and\nkeyphrase extraction', 57, 202, 680, 194, { size: 65, color: c.white });
  display(page, 'Termfolio', 60, 480, 600, 84, { size: 42, color: c.peach });
  display(page, 'Group 9', 797, 88, 438, 72, { size: 49 });
  shape(page, 795, 193, 430, 56, c.peach);
  roster.forEach(([name, roll], index) => {
    const row = 195 + index * 56;
    text(page, name, 809, row, 251, 51, { size: 20, bold: index === 0 });
    text(page, roll, 1067, row, 145, 51, { size: 18, bold: index === 0, align: 'right' });
  });
  notes(page, 'Introduce Termfolio and the Group 9 members. Names and roll numbers follow the supplied class roster.');
}

{
  const page = slide();
  title(page, 'Give a document a searchable index', 2);
  shape(page, 0, 202, 1280, 254, c.ink);
  display(page, 'Find the key terms.\nTrace each one to the text.', 63, 229, 735, 173, { size: 55, color: c.white });
  text(page, 'Termfolio ranks single words and phrases in English documents. A reader can inspect every match in context.',
    858, 259, 340, 115, { size: 22, color: c.white, wrap: true, anchor: 'top' });
  const uses = ['Screen abstracts for\na literature review', 'Tag reports by topic', 'Add search metadata'];
  uses.forEach((label, index) => {
    const x = 63 + 393 * index;
    shape(page, x, 519, 17, 17, c.peach, 'ellipse');
    text(page, label, x + 31, 507, 342, 65, { size: 24, wrap: true });
  });
  notes(page, 'In a paper about urban drainage, useful terms might include “rain gardens” and “urban runoff”. This is an extractive task because the terms can be traced to the document.');
}

{
  const page = slide(c.light);
  title(page, '2,000 abstracts with human labels', 3);
  const counts = [['Training', 'train'], ['Validation', 'validation'], ['Held-out test', 'test']];
  counts.forEach(([name, key], index) => {
    const y = 222 + index * 111;
    display(page, stats.eda.splits[key].documents.toLocaleString('en-US'), 67, y, 275, 66, { size: 53, color: c.aubergine });
    text(page, name, 69, y + 66, 279, 26, { size: 19 });
  });
  shape(page, 378, 205, 835, 402, c.white);
  display(page, 'How long were the reference terms?', 402, 220, 776, 53, { size: 32 });
  const values = Object.values(stats.eda.reference_lengths);
  const labels = ['1 word', '2 words', '3 words', '4 words', '5+ words'];
  values.forEach((count, index) => {
    const height = 213 * count / Math.max(...values);
    const x = 434 + 148 * index;
    shape(page, x, 518 - height, 98, height, index === 1 ? c.aubergine : c.peach);
    text(page, count.toLocaleString('en-US'), x - 10, 481 - height, 118, 31, { size: 19, align: 'center' });
    text(page, labels[index], x - 13, 522, 124, 34, { size: 16, align: 'center', color: c.muted });
  });
  text(page, 'Two-word phrases account for 51% of the references.', 401, 566, 782, 29, { size: 18, color: c.aubergine });
  notes(page, 'Inspec contains 2,000 English scientific abstracts. We use the original split and the uncontrolled keyphrases from indexers. Data from the Inspec Database kindly supplied by The IET.\nOriginal paper: https://aclanthology.org/W03-1028/\nArchive: https://github.com/snkim/AutomaticKeyphraseExtraction');
}

{
  const page = slide();
  title(page, 'How a phrase becomes a candidate', 4);
  const steps = [
    ['Clean', 'Normalize Unicode, join wrapped lines, and check for empty or duplicate records.'],
    ['Tokenize', 'Normalize case and possessives. Keep original character positions.'],
    ['Build phrases', 'Take one to four words within a punctuation boundary. Drop stopwords at the edges.'],
    ['Measure', 'Record frequency, first position, phrase length, title match, and other features.'],
  ];
  shape(page, 0, 268, 1280, 5, c.peach);
  steps.forEach(([heading, detail], index) => {
    const x = 62 + 295 * index;
    display(page, String(index + 1), x, 193, 252, 68, { size: 58, color: c.aubergine });
    display(page, heading, x, 294, 254, 60, { size: 32 });
    text(page, detail, x, 366, 249, 164, { size: 21, wrap: true, anchor: 'top' });
  });
  notes(page, 'The cleaning pass found zero missing or duplicate records. Connectors such as “of” can appear inside a phrase. Source positions are used to highlight terms in the app.');
}

{
  const page = slide(c.light);
  title(page, 'One candidate set, three ranking methods', 5);
  shape(page, 63, 200, 631, 390, c.ink);
  display(page, 'Learned ranker', 93, 219, 562, 68, { size: 43, color: c.peach });
  text(page, '13 standardized features\nWeighted sum and bias\nSigmoid score', 95, 316, 563, 141,
    { size: 28, color: c.white, anchor: 'top' });
  text(page, `Epoch ${stats.chosen_epoch} had the best validation F1@10.`, 95, 506, 550, 43, { size: 18, color: c.peach });
  display(page, 'TF-IDF', 754, 217, 450, 55, { size: 40 });
  text(page, 'Rewards repeated terms that are rare across training abstracts.', 757, 286, 440, 86, { size: 22, wrap: true, anchor: 'top' });
  display(page, 'RAKE', 754, 397, 450, 55, { size: 40 });
  text(page, 'Scores terms by how often their content words appear together.', 757, 464, 440, 88, { size: 22, wrap: true, anchor: 'top' });
  notes(page, 'The learned ranker is regularized logistic regression, trained on 104,006 candidates with 7,043 positive matches. Validation selects the checkpoint before test. RAKE scores candidate words by degree divided by frequency.\nTF-IDF: https://nlp.stanford.edu/IR-book/html/htmledition/tf-idf-weighting-1.html\nRAKE: https://doi.org/10.1002/9780470689646.ch1');
}

{
  const page = slide();
  title(page, 'The learned ranker led at both cutoffs', 6);
  const labels = { learned: 'Learned ranker', tfidf: 'TF-IDF', rake: 'RAKE' };
  const results = [['Method', 'Top k', 'Precision', 'Recall', 'F1']];
  for (const k of ['5', '10']) {
    for (const [method, label] of Object.entries(labels)) {
      const score = stats.held_out_test[method][k];
      results.push([label, k, ...['precision', 'recall', 'f1'].map((key) => score[key].toFixed(3))]);
    }
  }
  shape(page, 0, 224, 387, 384, c.blush);
  display(page, stats.held_out_test.learned['10'].f1.toFixed(3), 56, 279, 314, 120, { size: 89, color: c.aubergine });
  text(page, 'Macro F1 at 10', 64, 402, 300, 42, { size: 23, bold: true });
  text(page, '500 test abstracts\nExact normalized phrase matches', 64, 474, 286, 81, { size: 18, wrap: true, anchor: 'top' });
  const table = page.tables.add({ rows: results.length, columns: results[0].length, values: results,
    left: 425, top: 225, width: 779, height: 350, columnWidths: [266, 87, 150, 139, 137] });
  table.styleOptions = { headerRow: false, bandedRows: false };
  table.borders.assign({ fill: 'none', width: 0 });
  results.forEach((row, i) => {
    table.rows[i].height = 50;
    row.forEach((_, j) => {
      const cell = table.getCell(i, j);
      cell.fill = i === 0 ? c.ink : i === 4 ? c.peach : i % 2 ? c.white : c.light;
      cell.text.style = { typeface: font.body, fontSize: 20, bold: i === 0 || i === 4,
        color: i === 0 ? c.white : c.ink, verticalAlignment: 'middle', alignment: j ? 'center' : 'left' };
    });
  });
  notes(page, 'Precision is the share of returned terms that match a reference. Recall is the share of references returned. F1 is calculated per abstract and then averaged. Retrieving ten terms increases recall at the cost of precision.');
}

{
  const page = slide(c.light);
  title(page, 'Send a document. Get ranked terms.', 7);
  const shot = await fs.readFile(path.join(root, 'docs/screenshots/highlighted.png'));
  shape(page, 46, 176, 816, 469, c.blush);
  page.images.add({ blob: shot, contentType: 'image/png',
    alt: 'Termfolio chat with a ranked reply and highlighted matches in the rain gardens passage.', fit: 'contain',
    position: { left: 52, top: 183, width: 803, height: 455 } });
  const actions = ['Paste a passage or attach a file.', 'Set the method and result count, then send.', 'Select a term to see it in context. Export the list if needed.'];
  actions.forEach((action, index) => {
    const y = 230 + index * 129;
    display(page, String(index + 1), 894, y, 37, 47, { size: 32, color: c.aubergine });
    text(page, action, 941, y + 4, 261, 99, { size: 21, wrap: true, anchor: 'top' });
  });
  notes(page, 'Run python app.py before class. Open http://127.0.0.1:8000 and select New chat. Paste an abstract or attach a document, select a ranking method and send it. Click a term to show its matches. Send the abstract again with another ranker to compare the replies.');
}

{
  const page = slide(c.ink);
  shape(page, 745, 0, 535, 720, c.peach);
  display(page, 'What the model can find', 59, 88, 653, 79, { size: 49, color: c.white });
  display(page, `${(stats.eda.splits.test.candidate_coverage * 100).toFixed(1)}%`, 58, 201, 652, 180,
    { size: 128, color: c.peach });
  text(page, 'of test references appeared in the candidate set before ranking.', 64, 407, 577, 112,
    { size: 28, color: c.white, wrap: true, anchor: 'top' });
  display(page, 'Next steps', 801, 200, 416, 72, { size: 42 });
  text(page, 'Use part-of-speech tags to cut down on phrase fragments.\n\nMeasure how the ranker performs on reports, news, and class notes.',
    803, 299, 375, 257, { size: 23, wrap: true, anchor: 'top' });
  notes(page, 'The candidate rules limit what the ranker can return. Some references are absent from the source, use different wording, or fall outside the one-to-four-word rules. The reported scores describe Inspec abstracts.');
}

await fs.mkdir(staging, { recursive: true });
for (const [index, page] of deck.slides.items.entries()) {
  const preview = await deck.export({ slide: page, format: 'png', scale: 1 });
  await fs.writeFile(path.join(staging, `slide-${index + 1}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const draft = path.join(staging, 'candidate.pptx');
await (await PresentationFile.exportPptx(deck)).save(draft);
const skill = process.env.TERMFOLIO_PRESENTATION_SKILL;
if (skill && process.env.TERMFOLIO_RENDER_ONLY !== '1') {
  const validators = path.join(skill, 'container_tools');
  const { finalizePresentation } = await import(pathToFileURL(path.join(validators, 'artifact_tool_utils.mjs')));
  const result = await finalizePresentation({
    workspaceDir: root, candidatePath: draft, finalPath: final,
    explicitTotalSlideCount: 8, requiredNativeTableOwnerSlides: [6],
    fontPolicy: { basis: 'design', families: Object.values(font) },
    pythonExecutable: process.env.TERMFOLIO_RUNTIME_PYTHON,
    integrityValidatorPath: path.join(validators, 'inspect_presentation_package_integrity.py'),
    layoutValidatorPath: path.join(validators, 'inspect_presentation_layout_geometry.py'),
    layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-heading-fit', '--require-native-table-slide', '6'],
    verifyArtifactToolImport: true,
    receiptPath: path.join(staging, 'validation.json'),
  });
  console.log(`Saved and verified ${result.finalPath}`);
} else if (process.env.TERMFOLIO_RENDER_ONLY !== '1') {
  await fs.copyFile(draft, final);
}
