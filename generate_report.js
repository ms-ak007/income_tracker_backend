const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Initialize the PDF in Portrait Letter size (612 x 792 pt) with bufferedPageRange to draw headers/footers
const doc = new PDFDocument({ 
  size: 'LETTER', 
  layout: 'portrait', 
  margin: 50, 
  bufferPages: true 
});

const pdfPath = path.join(__dirname, '../internship_report.pdf');
const writeStream = fs.createWriteStream(pdfPath);
doc.pipe(writeStream);

// Design Tokens (Executive Document Theme)
const theme = {
  primary: '#1e3a8a', // Dark Blue
  secondary: '#475569', // Slate Gray
  textDark: '#0f172a', // Off Black
  textBody: '#334155', // Slate Body
  textMuted: '#64748b', // Muted Gray
  lightBg: '#f8fafc', // Very Light Gray
  border: '#cbd5e1', // Light gray border
  accent: '#10b981', // Emerald Success
  accentLight: '#ecfdf5',
  white: '#ffffff'
};

// --- TYPOGRAPHY HELPERS ---

function addTitle(doc, text) {
  doc.fontSize(24).font('Helvetica-Bold').fillColor(theme.primary).text(text, { align: 'center', lineGap: 6 });
}

function addSubtitle(doc, text) {
  doc.fontSize(14).font('Helvetica').fillColor(theme.secondary).text(text, { align: 'center', lineGap: 14 });
}

function addHeading1(doc, text) {
  doc.fontSize(16).font('Helvetica-Bold').fillColor(theme.primary).text(text, { lineGap: 6 });
  doc.y += 4;
}

function addHeading2(doc, text) {
  doc.fontSize(12).font('Helvetica-Bold').fillColor(theme.textDark).text(text, { lineGap: 4 });
  doc.y += 2;
}

function addHeading3(doc, text) {
  doc.fontSize(10.5).font('Helvetica-Bold').fillColor(theme.secondary).text(text, { lineGap: 3 });
  doc.y += 1.5;
}

function addParagraph(doc, text) {
  doc.fontSize(10).font('Helvetica').fillColor(theme.textBody).text(text, { align: 'justify', lineGap: 3 });
  doc.y += 8;
}

function addBullet(doc, boldPart, normalPart) {
  doc.fontSize(10).font('Helvetica-Bold').fillColor(theme.textDark).text('  • ' + boldPart, { continued: true });
  doc.font('Helvetica').fillColor(theme.textBody).text(normalPart, { lineGap: 2 });
  doc.y += 2;
}

function addCodeBlock(doc, codeLines) {
  const boxY = doc.y;
  const padding = 10;
  
  // Calculate text height
  doc.font('Courier').fontSize(8.5).fillColor(theme.textDark);
  let textHeight = 0;
  codeLines.forEach(line => {
    textHeight += doc.currentLineHeight() + 1.5;
  });

  // Draw background box
  doc.rect(50, boxY, 512, textHeight + padding * 2).fill(theme.lightBg);
  
  // Write text
  let currentY = boxY + padding;
  codeLines.forEach(line => {
    doc.text(line, 60, currentY, { lineBreak: false });
    currentY += doc.currentLineHeight() + 1.5;
  });

  doc.y = boxY + textHeight + padding * 2 + 10;
}

function drawDivider(doc) {
  doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor(theme.border).lineWidth(1).stroke();
  doc.y += 10;
}

// ==========================================
// PAGE 1: COVER PAGE
// ==========================================
function buildCoverPage(doc) {
  // Border decorations
  doc.rect(20, 20, 572, 752).strokeColor(theme.primary).lineWidth(2).stroke();
  doc.rect(25, 25, 562, 742).strokeColor(theme.border).lineWidth(0.5).stroke();

  doc.y = 120;
  addSubtitle(doc, 'INTERNSHIP PROJECT REPORT');
  doc.y += 10;
  addTitle(doc, 'FINFLOW: PERSONAL FINANCE TRACKER');
  
  // Decorative line
  doc.y += 15;
  doc.moveTo(200, doc.y).lineTo(412, doc.y).strokeColor(theme.primary).lineWidth(3).stroke();
  
  doc.y += 40;
  addSubtitle(doc, 'A secure, lightweight Single-Page Application (SPA) for income and expenditure tracking with dynamic pot allocation.');

  doc.y = 380;
  
  // Submissions Details Box
  const boxX = 120;
  const boxY = doc.y;
  const boxW = 372;
  const boxH = 180;
  
  doc.rect(boxX, boxY, boxW, boxH).fill(theme.lightBg);
  doc.rect(boxX, boxY, boxW, boxH).strokeColor(theme.border).lineWidth(1).stroke();
  
  doc.y = boxY + 15;
  doc.fontSize(11).font('Helvetica-Bold').fillColor(theme.primary).text('PROJECT METADATA', { align: 'center' });
  doc.y += 8;
  
  const details = [
    ['Intern Role:', 'Full-Stack Developer Intern'],
    ['Technology Stack:', 'Node.js, Express, sql.js (WASM SQLite), HTML5, CSS3, Chart.js'],
    ['Authentication:', 'JSON Web Tokens (JWT), bcryptjs Hashing'],
    ['Database Storage:', 'Disk-Persisted SQLite Binary File'],
    ['Submission Date:', 'June 2026']
  ];
  
  details.forEach(([lbl, val]) => {
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(theme.textDark).text('  ' + lbl.padEnd(20), 140, doc.y, { continued: true });
    doc.font('Helvetica').fillColor(theme.textBody).text(val);
    doc.y += 5;
  });

  // Footer banner on cover
  doc.y = 700;
  doc.fontSize(10).font('Helvetica-Bold').fillColor(theme.secondary).text('ACADEMIC & INDUSTRIAL INTERNSHIP PROGRAM', { align: 'center' });
}

// ==========================================
// PAGE 2: TABLE OF CONTENTS & ABSTRACT
// ==========================================
function buildPage2(doc) {
  doc.y = 60;
  addHeading1(doc, 'TABLE OF CONTENTS');
  drawDivider(doc);

  const toc = [
    ['1. Executive Summary & Abstract', 'Page 2'],
    ['2. Introduction & System Objectives', 'Page 3'],
    ['3. System Architecture & Design Patterns', 'Page 4'],
    ['4. Database Schema Design', 'Page 5'],
    ['5. Backend REST API Specifications', 'Page 6'],
    ['6. Frontend Layout & Styling Design System', 'Page 7'],
    ['7. Development Challenges, Solutions & Conclusion', 'Page 8']
  ];

  doc.y += 10;
  toc.forEach(([title, page]) => {
    doc.fontSize(10.5).font('Helvetica-Bold').fillColor(theme.textDark).text(title, { continued: true });
    // Dot leader
    const dotsCount = 80 - title.length - page.length;
    const dots = '.'.repeat(Math.max(10, dotsCount));
    doc.font('Helvetica').fillColor(theme.textMuted).text(dots, { continued: true });
    doc.font('Helvetica-Bold').fillColor(theme.primary).text(' ' + page);
    doc.y += 8;
  });

  doc.y += 40;
  addHeading1(doc, 'ABSTRACT / EXECUTIVE SUMMARY');
  drawDivider(doc);

  addParagraph(doc, 
    'Effective personal finance management is crucial for individual economic stability. The FinFlow application was designed and implemented during this internship to serve as a fast, secure, and intuitive web-based tracking dashboard. The primary goal of the system is to allow users to document their income and expenses in real-time, categorized for granular insight. Unlike traditional tracking systems, FinFlow introduces a customized "Income Source Balances" feature, which maps transactions to specific earning streams (pots) so that the user knows exactly which budget funds remain in reserve.'
  );

  addParagraph(doc, 
    'The backend infrastructure leverages Node.js with the Express framework and SQLite database server. To guarantee maximum deployability without native compilation bottlenecks (e.g. node-gyp build failures on target hosts), sql.js was incorporated. Data security is established at the server level using bcryptjs for salted password hashing and stateless JSON Web Tokens (JWT) for secure session headers. On the client side, the frontend is built entirely using semantic HTML5 structures, vanilla CSS featuring advanced Custom CSS Variable tokens, and Chart.js for canvas rendering of financial graphics. The resulting application is light, fast, modular, and operates with zero cloud dependencies, ensuring total user data privacy.'
  );
}

// ==========================================
// PAGE 3: INTRODUCTION & SYSTEM OBJECTIVES
// ==========================================
function buildPage3(doc) {
  doc.y = 60;
  addHeading1(doc, '1. INTRODUCTION & SYSTEM OBJECTIVES');
  drawDivider(doc);

  addHeading2(doc, '1.1 Problem Statement');
  addParagraph(doc, 
    'Most spreadsheet-based or commercial finance trackers suffer from significant drawbacks: they are either stored locally in unstructured Excel sheets, require third-party cloud synchronization that raises data privacy concerns, or present confusing user interfaces. Furthermore, standard expense trackers only summarize outflow without correlating which specific income stream (e.g., primary salary, freelance pot, investment interest) is financing a particular expense. This separation creates a visibility gap in budget management.'
  );

  addHeading2(doc, '1.2 FinFlow Vision');
  addParagraph(doc, 
    'FinFlow bridges this gap. It provides a visual personal dashboard that not only tracks income and expenses but allows users to tag their expenditures to specific income streams. This pot-based accounting model gives people immediate clarity on how much money is left in individual income reservoirs.'
  );

  addHeading2(doc, '1.3 Objectives of the Project');
  addParagraph(doc, 
    'The system was built to accomplish five primary objectives:'
  );

  addBullet(doc, 'Stateless Token-Based Authentication: ', 'Implement secure registration and login using JWT session verification to keep client states decoupled from the server database.');
  addBullet(doc, 'Real-time Aggregated Financial Tiles: ', 'Calculate and present the total income, expenses, and net balance of the active month with visual progress indicators showing savings/outlay ratios.');
  addBullet(doc, 'Granular Income Pot Allocations: ', 'Implement dynamic database joins to track earnings, spending, and available reserves per income source (e.g. salary, freelancing, investments).');
  addBullet(doc, 'Data Modeling & Persistence: ', 'Utilize an SQL-compliant schema built on SQLite and managed via sql.js to persist data to a standard binary .db file on write and timer-based autosave.');
  addBullet(doc, 'Accounting Report Exportation: ', 'Design automated CSV generation routers to download monthly and yearly financial logs directly from the web client.');
}

// ==========================================
// PAGE 4: SYSTEM ARCHITECTURE & DESIGN
// ==========================================
function buildPage4(doc) {
  doc.y = 60;
  addHeading1(doc, '2. SYSTEM ARCHITECTURE & DESIGN PATTERNS');
  drawDivider(doc);

  addParagraph(doc, 
    'FinFlow is built around a classic Client-Server Architecture. The frontend operates as a Single-Page Application (SPA), while the backend acts as a headless REST API service serving static files and routing database queries.'
  );

  addHeading2(doc, '2.1 Architectural Flow Diagram Description');
  addParagraph(doc, 
    'The diagram below represents the system components and data pathways:'
  );

  // Custom vector drawing representing Architecture
  const archY = doc.y + 10;
  const boxW = 100;
  const boxH = 40;
  
  // Client Box
  doc.rect(60, archY, boxW, boxH).strokeColor(theme.primary).lineWidth(1.5).stroke();
  doc.fillColor(theme.textDark).font('Helvetica-Bold').fontSize(10).text('SPA Client', 80, archY + 12);
  doc.font('Helvetica').fontSize(8).text('HTML5/CSS3/JS', 80, archY + 24);

  // Arrow 1 (Request)
  doc.strokeColor(theme.secondary).lineWidth(1);
  doc.moveTo(160, archY + 15).lineTo(230, archY + 15).stroke();
  doc.moveTo(225, archY + 12).lineTo(230, archY + 15).lineTo(225, archY + 18).stroke();
  doc.fillColor(theme.textMuted).fontSize(7).text('HTTPS (JWT)', 168, archY + 5);

  // Arrow 2 (Response)
  doc.moveTo(230, archY + 28).lineTo(160, archY + 28).stroke();
  doc.moveTo(165, archY + 25).lineTo(160, archY + 28).lineTo(165, archY + 31).stroke();
  doc.fillColor(theme.textMuted).fontSize(7).text('JSON Data / CSV', 168, archY + 32);

  // Backend Box
  doc.rect(230, archY, boxW, boxH).strokeColor(theme.primary).lineWidth(1.5).stroke();
  doc.fillColor(theme.textDark).font('Helvetica-Bold').fontSize(10).text('Express Router', 242, archY + 12);
  doc.font('Helvetica').fontSize(8).text('Node.js API Service', 242, archY + 24);

  // Arrow 3 (DB Query)
  doc.strokeColor(theme.secondary).lineWidth(1);
  doc.moveTo(330, archY + 20).lineTo(400, archY + 20).stroke();
  doc.moveTo(395, archY + 17).lineTo(400, archY + 20).lineTo(395, archY + 23).stroke();

  // DB Box
  doc.rect(400, archY, boxW, boxH).strokeColor(theme.primary).lineWidth(1.5).stroke();
  doc.fillColor(theme.textDark).font('Helvetica-Bold').fontSize(10).text('sql.js Database', 415, archY + 12);
  doc.font('Helvetica').fontSize(8).text('tracker.db file storage', 412, archY + 24);

  doc.y = archY + 60;

  addHeading2(doc, '2.2 Main Components');
  
  addHeading3(doc, '2.2.1 REST API Service (Backend)');
  addParagraph(doc, 
    'The Node.js server serves the UI files and validates client requests. It implements middleware for CORS policy handles, JSON request payload deserialization, and authentication checking. All data operations are handled synchronously or asynchronously through database adapter files.'
  );

  addHeading3(doc, '2.2.2 Security Middleware');
  addParagraph(doc, 
    'Stateless authentication is performed via a dedicated middleware router: it extracts JWT strings from the HTTP Authorization header, verifies signature legitimacy against a server secret string, and binds the decrypted `user_id` context to the Express request instance.'
  );

  addHeading3(doc, '2.2.3 Single-Page Frontend');
  addParagraph(doc, 
    'The frontend uses vanilla client scripts (`dashboard.js` and `auth.js`) to capture interface triggers, post form fields to endpoints, store tokens in localStorage, and dynamically update DOM sub-sections (Pages) using display style variables.'
  );
}

// ==========================================
// PAGE 5: DATABASE SCHEMA DESIGN
// ==========================================
function buildPage5(doc) {
  doc.y = 60;
  addHeading1(doc, '3. DATABASE PERSISTENCE & SCHEMA DESIGN');
  drawDivider(doc);

  addParagraph(doc, 
    'To avoid compiling binary SQLite drivers (which frequently break depending on operating systems or Node versions), this project utilizes sql.js — a pure WebAssembly port of SQLite. The database database is initialized in memory, loaded from a local binary file `data/tracker.db` if present, and persisted back to disk immediately on transaction changes or periodically via a 10-second background ticker.'
  );

  addHeading2(doc, '3.1 SQL Schemas');
  addParagraph(doc, 
    'The database consists of two tables: users and transactions. A composite index is declared to accelerate range queries.'
  );

  const schemas = [
    '// 1. Users Table Schema',
    'CREATE TABLE IF NOT EXISTS users (',
    '  id            INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  name          TEXT    NOT NULL,',
    '  email         TEXT    NOT NULL UNIQUE,',
    '  password_hash TEXT    NOT NULL,',
    '  created_at    TEXT    DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%SZ\',\'now\'))',
    ');',
    '',
    '// 2. Transactions Table Schema',
    'CREATE TABLE IF NOT EXISTS transactions (',
    '  id          INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id     INTEGER NOT NULL,',
    '  type        TEXT    NOT NULL,  -- \'income\' or \'expense\'',
    '  category    TEXT    NOT NULL,',
    '  amount      REAL    NOT NULL,',
    '  description TEXT    DEFAULT \'\',',
    '  date        TEXT    NOT NULL,  -- \'YYYY-MM-DD\'',
    '  paid_from   TEXT    DEFAULT NULL,',
    '  created_at  TEXT    DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%SZ\',\'now\')),',
    '  FOREIGN KEY (user_id) REFERENCES users(id)',
    ');',
    '',
    '// 3. Performance Indexing',
    'CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);'
  ];

  addCodeBlock(doc, schemas);

  addHeading2(doc, '3.2 Data Modeling Rationales');
  addBullet(doc, 'Paid From Reference: ', 'The paid_from field represents the pot description (e.g. Salary Pot) that an expense draws from. It binds expenses to income categories, enabling the source balances report.');
  addBullet(doc, 'ISO Dates: ', 'Dates are recorded in YYYY-MM-DD ISO format, which enables natural text sorting and efficient SQLite date-substring slicing (`substr(date,1,7)`).');
  addBullet(doc, 'Composite Index: ', 'Declaring idx_tx_user_date ensures that when users load their dashboard, queries filtering by month and user ID bypass full-table scans.');
}

// ==========================================
// PAGE 6: BACKEND API SPECIFICATIONS
// ==========================================
function buildPage6(doc) {
  doc.y = 60;
  addHeading1(doc, '4. BACKEND REST API ROUTE SPECIFICATIONS');
  drawDivider(doc);

  addParagraph(doc, 
    'The server exposes HTTP interfaces structured around clean restful endpoints. The table below represents the core route maps:'
  );

  // Custom detailed table with text columns wrapping correctly
  // Headers: Endpoint, Method, Auth, Purpose
  const headers = ['Route Endpoint', 'Method', 'Auth', 'Functional Purpose'];
  
  // Custom draw table to fit within portrait layout
  const tableY = doc.y + 10;
  const colW = [180, 60, 45, 227]; // Column widths
  
  // Header background
  doc.rect(50, tableY, 512, 22).fill(theme.primary);
  
  doc.fillColor(theme.white).font('Helvetica-Bold').fontSize(9);
  doc.text('Route Endpoint', 55, tableY + 6);
  doc.text('Method', 235, tableY + 6);
  doc.text('Auth', 295, tableY + 6);
  doc.text('Functional Purpose', 340, tableY + 6);

  const apiRows = [
    ['/api/auth/signup', 'POST', 'No', 'Registers user, hashes password, returns JWT token.'],
    ['/api/auth/login', 'POST', 'No', 'Verifies credentials, returns JWT token.'],
    ['/api/user/me', 'GET', 'Yes', 'Retrieves currently authenticated user metadata.'],
    ['/api/transactions', 'GET', 'Yes', 'Fetches user logs. Optional: ?month=YYYY-MM filter.'],
    ['/api/transactions', 'POST', 'Yes', 'Inserts transaction (validates fields & paid_from).'],
    ['/api/transactions/:id', 'DELETE', 'Yes', 'Removes transaction record, validating ownership.'],
    ['/api/reports/monthly', 'GET', 'Yes', 'Aggregates monthly sums (income, expense, net).'],
    ['/api/reports/monthly/:y/:m', 'GET', 'Yes', 'Fetches category-wise sums & logs for one month.'],
    ['/api/reports/income-sources', 'GET', 'Yes', 'Tracks earnings, outlay, & balances per source pot.'],
    ['/api/reports/yearly/:year', 'GET', 'Yes', 'Provides full monthly and category details for a year.'],
    ['/api/download/monthly/:y/:m', 'GET', 'Yes', 'Generates CSV attachment download for monthly log.'],
    ['/api/download/yearly/:y', 'GET', 'Yes', 'Generates CSV attachment download for annual log.']
  ];

  let currentY = tableY + 22;
  doc.fontSize(8).font('Helvetica');
  
  apiRows.forEach(row => {
    // Row background
    doc.rect(50, currentY, 512, 22).fill(currentY % 44 === 0 ? theme.lightBg : theme.white);
    doc.rect(50, currentY, 512, 22).strokeColor(theme.borderLight).lineWidth(0.5).stroke();

    doc.fillColor(theme.textDark).font('Helvetica-Bold');
    doc.text(row[0], 55, currentY + 6); // Route

    // Method coloring
    let methodColor = theme.textBody;
    if (row[1] === 'POST') methodColor = theme.primary;
    if (row[1] === 'DELETE') methodColor = theme.danger;
    
    doc.fillColor(methodColor).font('Helvetica-Bold');
    doc.text(row[1], 235, currentY + 6); // Method

    doc.fillColor(theme.textSecondary).font('Helvetica');
    doc.text(row[2], 295, currentY + 6); // Auth

    doc.fillColor(theme.textBody);
    doc.text(row[3], 340, currentY + 6, { width: colW[3] - 10, height: 16, ellipsis: true }); // Purpose
    
    currentY += 22;
  });

  doc.y = currentY + 15;
  addParagraph(doc, 
    'Security Note: Endpoints requiring authorization verify JWT headers format: "Authorization: Bearer <token>". Invalid tokens trigger 401 Unauthorized responses. Owner ownership checking is executed before deleting transactions, preventing data tampering between distinct users.'
  );
}

// ==========================================
// PAGE 7: FRONTEND INTERFACE & DESIGN SYSTEM
// ==========================================
function buildPage7(doc) {
  doc.y = 60;
  addHeading1(doc, '5. FRONTEND INTERFACE & CUSTOM DESIGN SYSTEM');
  drawDivider(doc);

  addParagraph(doc, 
    'The client-side interface is developed using modular semantic HTML5 divisions, responsive layouts, and structured styling in style.css. Custom CSS variables (CSS tokens) establish a consistent visual identity across the signup form, navigation, widgets, and modal panels.'
  );

  addHeading2(doc, '5.1 Design Tokens (CSS Variables)');
  const cssVariables = [
    ':root {',
    '  --bg-primary: #0b0f19;         /* Premium deep dark background */',
    '  --bg-card: rgba(22, 28, 45, 0.6); /* Translucent glass-morphic backdrop */',
    '  --border: rgba(255, 255, 255, 0.08);',
    '  --primary: #3b82f6;            /* Accent blue color */',
    '  --success: #10b981;            /* Profit emerald green */',
    '  --danger: #ef4444;             /* Expense red color */',
    '  --text-primary: #f8fafc;       /* Crisp white header text */',
    '  --text-secondary: #94a3b8;     /* Cool grey body text */',
    '}'
  ];
  addCodeBlock(doc, cssVariables);

  addHeading2(doc, '5.2 Interface Layout Structure');
  
  addHeading3(doc, '5.2.1 Auth Page (index.html)');
  addParagraph(doc, 
    'Features a split-panel configuration. The left hero block presents branding values, a dynamic radial background, and platform statistics. The right panel contains a clean authentication card, allowing users to toggle between Login and Signup forms with smooth UI tabs.'
  );

  addHeading3(doc, '5.2.2 Dashboard Grid (dashboard.html)');
  addParagraph(doc, 
    'Utilizes a CSS Grid layout with a persistent sidebar menu on the left and a scrollable canvas area on the right. Summary cards at the top of the canvas present key values. Below the cards, two Chart.js modules display historical income/outlay trends. Responsive navigation hides the sidebar into a hamburger menu on small devices.'
  );

  addHeading3(doc, '5.2.3 Add Transaction Dialog Overlay');
  addParagraph(doc, 
    'Renders a full-screen layout overlay (`display: none;` toggled to `flex;`). Features fields for amount inputs, category selection, description strings, date selectors, and a conditional selector block: when "Expense" is toggled, it displays the available "Income Source Pots" dropdown so that the transaction budget can be subtracted correctly.'
  );
}

// ==========================================
// PAGE 8: CHALLENGES, SOLUTIONS & CONCLUSION
// ==========================================
function buildPage8(doc) {
  doc.y = 60;
  addHeading1(doc, '6. KEY CHALLENGES, SOLUTIONS & CONCLUSION');
  drawDivider(doc);

  addHeading2(doc, '6.1 Technical Challenges & Resolutions');

  addBullet(doc, 'WASM Database File Lock & Sync: ', 'Since sql.js loads database tables entirely in system memory, file system locks and data losses on sudden app terminates could occur. Resolving this required writing a custom synchronous disk-writer module which triggers db.export() immediately on every database modification, combined with a 10-second background ticker to secure session changes.');
  
  addBullet(doc, 'Responsive Chart Scaling: ', 'When browser windows resized, Chart.js canvases frequently overflowed parent panels. This was resolved by disabling raw canvas sizes, setting responsive config rules, and container-bounding ratios inside the CSS flex layouts.');

  addBullet(doc, 'Stateless Auth Integrity: ', 'Stateless JWT tokens needed client-side redirection routines. Front-end router handlers were implemented to test token presence in localStorage immediately upon loading. If invalid, the page redirects users back to index.html with toast alerts.');

  addHeading2(doc, '6.2 Conclusion');
  addParagraph(doc, 
    'The development of FinFlow represents a secure, high-performance, and lightweight personal finance portal. During this internship, the full software lifecycle was executed: from designing relational database models, writing RESTful API routes, enforcing cryptography standards, and styling premium interactive front-ends, to producing modular wireframes. FinFlow operates efficiently on client computers with minimal deployment footprints, proving that pure-JavaScript libraries like sql.js are robust for local development ecosystems.'
  );

  addHeading2(doc, '6.3 Future Scope & System Roadmap');
  addBullet(doc, 'Category Management: ', 'Allow users to dynamically add, rename, and set budget limits on transaction categories directly from a settings panel.');
  addBullet(doc, 'Encrypted Sync: ', 'Develop optional peer-to-peer cloud syncing (e.g. WebRTC or GunDB) using custom client keys to backing directories, maintaining security while allowing multi-device tracking.');
  addBullet(doc, 'OCR Receipt Parsing: ', 'Incorporate client-side image-to-text models (Tesseract.js) to automate amount entry directly from photographed bill receipts.');
}

// --- CONSTRUCT PDF ---

try {
  console.log('Generating Cover Page...');
  buildCoverPage(doc);

  console.log('Generating Page 2: Table of Contents & Abstract...');
  doc.addPage();
  buildPage2(doc);

  console.log('Generating Page 3: Introduction & Objectives...');
  doc.addPage();
  buildPage3(doc);

  console.log('Generating Page 4: System Architecture...');
  doc.addPage();
  buildPage4(doc);

  console.log('Generating Page 5: Database Schema Design...');
  doc.addPage();
  buildPage5(doc);

  console.log('Generating Page 6: Backend API Specs...');
  doc.addPage();
  buildPage6(doc);

  console.log('Generating Page 7: Frontend & Design CSS...');
  doc.addPage();
  buildPage7(doc);

  console.log('Generating Page 8: Challenges & Conclusion...');
  doc.addPage();
  buildPage8(doc);

  // --- DRAW PAGE HEADERS & FOOTERS ---
  const range = doc.bufferedPageRange();
  console.log(`Finalizing headers and footers for ${range.count} pages...`);
  
  for (let i = 1; i < range.count; i++) { // Skip cover page (index 0)
    doc.switchToPage(i);
    
    // Draw Header
    doc.fontSize(8).font('Helvetica-Bold').fillColor(theme.textMuted);
    doc.text('INTERNSHIP PROJECT REPORT', 50, 25);
    doc.font('Helvetica').text('FinFlow — Personal Finance Tracker', 50, 35);
    
    doc.moveTo(50, 48).lineTo(562, 48).strokeColor(theme.border).lineWidth(0.5).stroke();
    
    // Draw Footer
    doc.moveTo(50, 742).lineTo(562, 742).strokeColor(theme.border).lineWidth(0.5).stroke();
    
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(theme.primary);
    doc.text('CONFIDENTIAL DOCUMENT', 50, 752);
    
    doc.font('Helvetica').fillColor(theme.textMuted);
    doc.text(`Page ${i + 1} of ${range.count}`, 50, 752, { align: 'right', width: 512 });
  }

  doc.end();
  console.log('Report PDF Generation Completed Successfully.');
} catch (err) {
  console.error('Error during report PDF generation:', err);
  process.exit(1);
}
