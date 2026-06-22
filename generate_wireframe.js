const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Initialize the PDF in Landscape Letter size (792 x 612 pt)
const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 0 });
const pdfPath = path.join(__dirname, '../wireframe.pdf');
const writeStream = fs.createWriteStream(pdfPath);
doc.pipe(writeStream);

// Design Tokens (Wireframe Theme)
const theme = {
  bg: '#f8fafc',
  sidebarBg: '#0f172a',
  sidebarText: '#94a3b8',
  sidebarActiveText: '#ffffff',
  sidebarActiveBg: '#1e293b',
  cardBg: '#ffffff',
  border: '#cbd5e1',
  borderLight: '#e2e8f0',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  primary: '#3b82f6', // Indigo/Blue Accent
  primaryLight: '#eff6ff',
  success: '#10b981', // Green Accent
  successLight: '#ecfdf5',
  danger: '#ef4444', // Red Accent
  dangerLight: '#fef2f2',
  white: '#ffffff'
};

// --- DRAWING HELPERS ---

function applyBackground(doc) {
  doc.rect(0, 0, 792, 612).fill(theme.bg);
}

function drawSidebar(doc, activeTab) {
  // Sidebar container
  doc.rect(0, 0, 180, 612).fill(theme.sidebarBg);

  // Logo: FinFlow
  // Draw a simple vector coin logo
  doc.circle(28, 40, 12).fill(theme.primary);
  doc.fillColor(theme.white).font('Helvetica-Bold').fontSize(12).text('$', 25, 34);
  doc.fillColor(theme.sidebarActiveText).font('Helvetica-Bold').fontSize(18).text('FinFlow', 48, 30);

  // Nav Items
  const navItems = [
    { name: 'Dashboard', icon: '[ ]' },
    { name: 'Transactions', icon: '[ ]' },
    { name: 'Monthly Reports', icon: '[ ]' },
    { name: 'Yearly Reports', icon: '[ ]' },
    { name: 'Analytics', icon: '[ ]' },
    { name: 'Source Balances', icon: '[ ]' }
  ];

  let y = 100;
  navItems.forEach(item => {
    const isActive = item.name === activeTab;
    if (isActive) {
      // Active background pill
      doc.roundedRect(10, y - 6, 160, 28, 6).fill(theme.sidebarActiveBg);
      doc.fillColor(theme.sidebarActiveText).font('Helvetica-Bold');
    } else {
      doc.fillColor(theme.sidebarText).font('Helvetica');
    }

    // Draw bullet/box indicator
    doc.lineWidth(1);
    doc.rect(20, y + 1, 10, 10);
    if (isActive) {
      doc.stroke(theme.primary);
      doc.rect(23, y + 4, 4, 4).fill(theme.primary);
    } else {
      doc.stroke(theme.sidebarText);
    }

    doc.fontSize(12).text(item.name, 40, y);
    y += 40;
  });

  // User mini card at bottom
  const userY = 520;
  doc.roundedRect(10, userY, 160, 80, 6).fill(theme.sidebarActiveBg);
  // Avatar circle placeholder
  doc.circle(35, userY + 28, 16).fill(theme.sidebarText);
  doc.fillColor(theme.sidebarActiveText).font('Helvetica-Bold').fontSize(12).text('U', 32, userY + 22);
  
  // User text
  doc.fillColor(theme.sidebarActiveText).font('Helvetica-Bold').fontSize(11).text('John Doe', 58, userY + 16);
  doc.fillColor(theme.sidebarText).font('Helvetica').fontSize(9).text('john@example.com', 58, userY + 30);
  
  // Logout
  doc.fillColor(theme.danger).font('Helvetica-Bold').fontSize(10).text('Sign Out', 58, userY + 46);
}

function drawTopbar(doc, pageTitle) {
  // Topbar Background
  doc.rect(180, 0, 612, 60).fill(theme.white);
  // Divider
  doc.moveTo(180, 60).lineTo(792, 60).strokeColor(theme.borderLight).lineWidth(1).stroke();

  // Page Title
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(18).text(pageTitle, 200, 20);

  // Quick Action Button
  const btnX = 670;
  const btnY = 15;
  doc.roundedRect(btnX, btnY, 100, 30, 4).fill(theme.primary);
  doc.fillColor(theme.white).font('Helvetica-Bold').fontSize(11).text('+ Add Entry', btnX + 18, btnY + 9);
}

function drawCard(doc, x, y, w, h, title, value, subtext, statusColor = 'normal') {
  // Card base
  doc.rect(x, y, w, h).fill(theme.white);
  doc.rect(x, y, w, h).strokeColor(theme.borderLight).lineWidth(1).stroke();

  // Color bar indicator (left edge)
  let indicatorColor = theme.border;
  if (statusColor === 'success') indicatorColor = theme.success;
  if (statusColor === 'danger') indicatorColor = theme.danger;
  if (statusColor === 'primary') indicatorColor = theme.primary;

  doc.rect(x, y, 4, h).fill(indicatorColor);

  // Text
  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), x + 16, y + 14);
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(18).text(value, x + 16, y + 30);
  if (subtext) {
    doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(9).text(subtext, x + 16, y + 54);
  }
}

function drawProgressBar(doc, x, y, w, percentage, color) {
  const barHeight = 6;
  doc.roundedRect(x, y, w, barHeight, 3).fill(theme.borderLight);
  doc.roundedRect(x, y, w * percentage, barHeight, 3).fill(color);
}

function drawTable(doc, x, y, w, headers, rows) {
  // Table Header Background
  const headerHeight = 24;
  doc.rect(x, y, w, headerHeight).fill(theme.bg);
  doc.rect(x, y, w, headerHeight).strokeColor(theme.borderLight).lineWidth(1).stroke();

  // Column layout calculation
  const colWidth = w / headers.length;

  // Header texts
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(10);
  headers.forEach((h, idx) => {
    doc.text(h, x + idx * colWidth + 10, y + 7);
  });

  // Table Body Rows
  let currentY = y + headerHeight;
  const rowHeight = 26;

  doc.font('Helvetica').fontSize(10);
  rows.forEach(row => {
    // Row background
    doc.rect(x, currentY, w, rowHeight).fill(theme.white);
    doc.rect(x, currentY, w, rowHeight).strokeColor(theme.borderLight).lineWidth(0.5).stroke();

    row.forEach((cell, idx) => {
      let cellColor = theme.textPrimary;
      // Bold if Income/Expense type
      if (cell === 'Income') {
        doc.font('Helvetica-Bold');
        cellColor = theme.success;
      } else if (cell === 'Expense') {
        doc.font('Helvetica-Bold');
        cellColor = theme.danger;
      } else {
        doc.font('Helvetica');
      }

      doc.fillColor(cellColor).text(cell, x + idx * colWidth + 10, currentY + 8);
    });

    currentY += rowHeight;
  });
}

function drawChartPlaceholder(doc, x, y, w, h, title, type = 'bar') {
  // Card base
  doc.rect(x, y, w, h).fill(theme.white);
  doc.rect(x, y, w, h).strokeColor(theme.borderLight).lineWidth(1).stroke();

  // Title
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(12).text(title, x + 16, y + 14);

  // Graph Area
  const graphX = x + 30;
  const graphY = y + 40;
  const graphW = w - 50;
  const graphH = h - 65;

  // Draw Grid Lines (dotted style simulated via line dashes)
  doc.strokeColor(theme.borderLight).lineWidth(1).dash(2, { space: 4 });
  for (let i = 0; i <= 3; i++) {
    const gridY = graphY + (graphH * i) / 3;
    doc.moveTo(graphX, gridY).lineTo(graphX + graphW, gridY).stroke();
  }
  doc.undash(); // Reset dash

  // Draw X/Y Axis
  doc.strokeColor(theme.textMuted).lineWidth(1.5);
  doc.moveTo(graphX, graphY).lineTo(graphX, graphY + graphH).lineTo(graphX + graphW, graphY + graphH).stroke();

  if (type === 'bar') {
    // Draw wireframe bar elements
    const numBars = 6;
    const barSpacing = graphW / numBars;
    const maxBarHeight = graphH - 10;
    
    for (let i = 0; i < numBars; i++) {
      const h1 = maxBarHeight * (0.3 + Math.random() * 0.6);
      const h2 = maxBarHeight * (0.2 + Math.random() * 0.5);
      const barW = barSpacing * 0.35;
      const barX = graphX + i * barSpacing + barSpacing * 0.15;
      
      // Income Bar (primary/success light)
      doc.rect(barX, graphY + graphH - h1, barW, h1).fill(theme.success);
      // Expense Bar (secondary/danger light)
      doc.rect(barX + barW + 2, graphY + graphH - h2, barW, h2).fill(theme.danger);
    }
  } else if (type === 'line') {
    // Draw wireframe line chart
    const numPoints = 8;
    const spacing = graphW / (numPoints - 1);
    
    doc.strokeColor(theme.primary).lineWidth(2);
    let lastX, lastY;

    for (let i = 0; i < numPoints; i++) {
      const px = graphX + i * spacing;
      const py = graphY + graphH - (graphH * (0.2 + Math.random() * 0.7));
      
      // Draw point
      doc.circle(px, py, 3).fill(theme.primary);
      
      if (i > 0) {
        doc.moveTo(lastX, lastY).lineTo(px, py).stroke();
      }
      lastX = px;
      lastY = py;
    }
  } else if (type === 'pie') {
    // Draw a pie/donut visual
    const cx = graphX + graphW / 2;
    const cy = graphY + graphH / 2;
    const radius = Math.min(graphW, graphH) / 2 - 5;

    // Outer circle
    doc.circle(cx, cy, radius).strokeColor(theme.border).lineWidth(2).stroke();
    
    // Wedge lines simulating divisions
    doc.moveTo(cx, cy).lineTo(cx, cy - radius).stroke();
    doc.moveTo(cx, cy).lineTo(cx + radius * 0.8, cy + radius * 0.5).stroke();
    doc.moveTo(cx, cy).lineTo(cx - radius * 0.6, cy + radius * 0.7).stroke();

    // Inner cutout (donut chart look)
    doc.circle(cx, cy, radius * 0.4).fill(theme.white);

    // Legend dots
    doc.font('Helvetica').fontSize(9);
    const legendX = x + 16;
    const legendY = y + h - 20;
    doc.circle(legendX, legendY, 3).fill(theme.primary);
    doc.fillColor(theme.textSecondary).text('Rent', legendX + 8, legendY - 3);

    doc.circle(legendX + 50, legendY, 3).fill(theme.success);
    doc.fillColor(theme.textSecondary).text('Food', legendX + 58, legendY - 3);

    doc.circle(legendX + 100, legendY, 3).fill(theme.danger);
    doc.fillColor(theme.textSecondary).text('Leisure', legendX + 108, legendY - 3);
  }
}

// ==========================================
// PAGE 1: AUTH & LANDING
// ==========================================
function buildPage1(doc) {
  applyBackground(doc);

  // Left Section (Hero Panel)
  doc.rect(0, 0, 396, 612).fill(theme.sidebarBg);
  
  // Decorative Orbs in background (dashed border vectors)
  doc.strokeColor('#1e293b').lineWidth(1).circle(100, 150, 80).stroke();
  doc.circle(300, 480, 120).stroke();

  // Branding
  doc.circle(50, 60, 15).fill(theme.primary);
  doc.fillColor(theme.white).font('Helvetica-Bold').fontSize(14).text('$', 47, 52);
  doc.fillColor(theme.sidebarActiveText).font('Helvetica-Bold').fontSize(22).text('FinFlow', 75, 48);

  // Headline
  doc.fillColor(theme.white).font('Helvetica-Bold').fontSize(36).text('Your money,\nyour story.', 50, 180, { lineGap: 8 });

  // Description
  doc.fillColor(theme.sidebarText).font('Helvetica').fontSize(14).text(
    'Track every rupee, understand your spending patterns, and take control of your financial future — all in one elegant dashboard.',
    50,
    300,
    { width: 300, lineGap: 6 }
  );

  // Stats block
  const statY = 460;
  // Stat 1
  doc.fillColor(theme.white).font('Helvetica-Bold').fontSize(18).text('100%', 50, statY);
  doc.fillColor(theme.sidebarText).font('Helvetica').fontSize(10).text('Data secure', 50, statY + 22);

  // Stat 2
  doc.fillColor(theme.white).font('Helvetica-Bold').fontSize(18).text('0₹', 150, statY);
  doc.fillColor(theme.sidebarText).font('Helvetica').fontSize(10).text('Cost to use', 150, statY + 22);

  // Stat 3
  doc.fillColor(theme.white).font('Helvetica-Bold').fontSize(18).text('Unlimited', 250, statY);
  doc.fillColor(theme.sidebarText).font('Helvetica').fontSize(10).text('Transactions', 250, statY + 22);

  // Right Section (Auth Form Panel)
  const cardX = 450;
  const cardY = 120;
  const cardW = 280;
  const cardH = 370;

  // Form Card
  doc.roundedRect(cardX, cardY, cardW, cardH, 8).fill(theme.white);
  doc.rect(cardX, cardY, cardW, cardH).strokeColor(theme.borderLight).lineWidth(1).stroke();

  // Tabs
  doc.roundedRect(cardX + 20, cardY + 20, 240, 36, 6).fill(theme.bg);
  doc.roundedRect(cardX + 22, cardY + 22, 118, 32, 4).fill(theme.white);
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(11).text('Sign In', cardX + 60, cardY + 34);
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(11).text('Create Account', cardX + 158, cardY + 34);

  // Title inside card
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(18).text('Welcome back', cardX + 20, cardY + 80);
  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(11).text('Sign in to access your dashboard', cardX + 20, cardY + 100);

  // Input 1: Email
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(10).text('Email address', cardX + 20, cardY + 135);
  doc.rect(cardX + 20, cardY + 150, 240, 34).strokeColor(theme.border).lineWidth(1).stroke();
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(11).text('you@example.com', cardX + 30, cardY + 162);

  // Input 2: Password
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(10).text('Password', cardX + 20, cardY + 205);
  doc.rect(cardX + 20, cardY + 220, 240, 34).strokeColor(theme.border).lineWidth(1).stroke();
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(11).text('••••••••', cardX + 30, cardY + 232);

  // Submit button
  doc.roundedRect(cardX + 20, cardY + 280, 240, 38, 4).fill(theme.primary);
  doc.fillColor(theme.white).font('Helvetica-Bold').fontSize(12).text('Sign In', cardX + 115, cardY + 293);

  // Helper text
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text("Don't have an account?", cardX + 55, cardY + 338);
  doc.fillColor(theme.primary).font('Helvetica-Bold').text('Create one', cardX + 168, cardY + 338);

  // Page index label
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Page 1 of 8: Landing & Auth', 700, 585);
}

// ==========================================
// PAGE 2: DASHBOARD OVERVIEW
// ==========================================
function buildPage2(doc) {
  applyBackground(doc);
  drawSidebar(doc, 'Dashboard');
  drawTopbar(doc, 'Financial Overview');

  // Page Section Info
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(12).text('June 2026', 200, 75);

  // 3 Summary Cards
  drawCard(doc, 200, 100, 175, 80, 'Total Income', '₹45,000.00', '12 transactions', 'success');
  drawProgressBar(doc, 216, 164, 143, 0.75, theme.success);

  drawCard(doc, 395, 100, 175, 80, 'Total Expenses', '₹18,500.00', '34 transactions', 'danger');
  drawProgressBar(doc, 411, 164, 143, 0.41, theme.danger);

  drawCard(doc, 590, 100, 175, 80, 'Net Balance', '₹26,500.00', 'This month', 'primary');

  // Income Pot Balance Widget (Mini horizontal view)
  const widgetY = 195;
  doc.rect(200, widgetY, 565, 75).fill(theme.white);
  doc.rect(200, widgetY, 565, 75).strokeColor(theme.borderLight).lineWidth(1).stroke();
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(11).text('💼 Income Source Balances', 215, widgetY + 12);
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(9).text('See available amounts per stream:', 215, widgetY + 28);
  
  // Pot 1
  doc.roundedRect(215, widgetY + 44, 155, 20, 3).fill(theme.successLight);
  doc.fillColor(theme.success).font('Helvetica-Bold').fontSize(9).text('Salary Pot: ₹35,000 left', 222, widgetY + 51);

  // Pot 2
  doc.roundedRect(380, widgetY + 44, 155, 20, 3).fill(theme.successLight);
  doc.fillColor(theme.success).font('Helvetica-Bold').fontSize(9).text('Freelance Pot: ₹3,500 left', 387, widgetY + 51);

  // Charts
  drawChartPlaceholder(doc, 200, 285, 275, 155, 'Income vs Expenses (6 months)', 'bar');
  drawChartPlaceholder(doc, 490, 285, 275, 155, 'Expense Categories', 'pie');

  // Recent Transactions
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(12).text('Recent Transactions', 200, 458);
  doc.fillColor(theme.primary).font('Helvetica').fontSize(10).text('View all →', 708, 458);

  const headers = ['Date', 'Description', 'Category', 'Type', 'Amount'];
  const rows = [
    ['2026-06-19', 'Grocery Shopping', 'Food', 'Expense', '₹2,450.00'],
    ['2026-06-18', 'Monthly Salary', 'Salary', 'Income', '₹45,000.00'],
    ['2026-06-15', 'Electricity Bill', 'Utilities', 'Expense', '₹1,200.00']
  ];
  drawTable(doc, 200, 475, 565, headers, rows);

  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Page 2 of 8: Dashboard Overview', 700, 585);
}

// ==========================================
// PAGE 3: TRANSACTIONS LOG
// ==========================================
function buildPage3(doc) {
  applyBackground(doc);
  drawSidebar(doc, 'Transactions');
  drawTopbar(doc, 'All Transactions');

  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(11).text('Complete history of your income and expenses', 200, 75);

  // Filter Bar area
  const filterY = 95;
  doc.rect(200, filterY, 565, 45).fill(theme.white);
  doc.rect(200, filterY, 565, 45).strokeColor(theme.borderLight).lineWidth(1).stroke();

  // Dropdown 1: Month
  doc.rect(215, filterY + 10, 120, 25).strokeColor(theme.border).lineWidth(1).stroke();
  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(10).text('Filter Month: All v', 225, filterY + 17);

  // Dropdown 2: Type
  doc.rect(345, filterY + 10, 120, 25).strokeColor(theme.border).lineWidth(1).stroke();
  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(10).text('Filter Type: All v', 355, filterY + 17);

  // Reset button
  doc.fillColor(theme.primary).font('Helvetica-Bold').fontSize(10).text('Clear Filters', 485, filterY + 22);

  // Transactions list Table (larger table filling the workspace height)
  const headers = ['Date', 'Description', 'Category', 'Type', 'Amount', 'Source Pot'];
  const rows = [
    ['2026-06-19', 'Grocery Shopping', 'Food', 'Expense', '₹2,450.00', 'Salary Pot'],
    ['2026-06-18', 'Monthly Salary', 'Salary', 'Income', '₹45,000.00', '-'],
    ['2026-06-15', 'Electricity Bill', 'Utilities', 'Expense', '₹1,200.00', 'Salary Pot'],
    ['2026-06-12', 'Netflix Subscription', 'Entertainment', 'Expense', '₹649.00', 'Salary Pot'],
    ['2026-06-10', 'Freelance Web Design', 'Freelance', 'Income', '₹8,500.00', '-'],
    ['2026-06-08', 'Petrol', 'Transport', 'Expense', '₹1,500.00', 'Freelance Pot'],
    ['2026-06-05', 'Dinner Out', 'Food', 'Expense', '₹1,850.00', 'Salary Pot'],
    ['2026-06-02', 'Gym Membership', 'Health', 'Expense', '₹1,000.00', 'Freelance Pot'],
    ['2026-05-28', 'ISP Broadband bill', 'Utilities', 'Expense', '₹999.00', 'Salary Pot'],
    ['2026-05-25', 'Interest Received', 'Investment', 'Income', '₹2,200.00', '-']
  ];

  drawTable(doc, 200, 155, 565, headers, rows);

  // Total summary banner at the bottom of table
  const summaryY = 445;
  doc.rect(200, summaryY, 565, 30).fill(theme.primaryLight);
  doc.rect(200, summaryY, 565, 30).strokeColor(theme.primary).lineWidth(0.5).stroke();
  
  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(10).text('Displaying 10 of 42 transactions in total.', 215, summaryY + 10);
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(10).text('Total Income: ₹55,700', 420, summaryY + 10);
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(10).text('Total Expense: ₹11,648', 580, summaryY + 10);

  // Pagination
  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(10).text('< Prev', 200, 500);
  doc.fillColor(theme.textPrimary).text('Page 1 of 5', 450, 500);
  doc.fillColor(theme.primary).text('Next >', 730, 500);

  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Page 3 of 8: Transactions Log', 700, 585);
}

// ==========================================
// PAGE 4: MONTHLY REPORTS
// ==========================================
function buildPage4(doc) {
  applyBackground(doc);
  drawSidebar(doc, 'Monthly Reports');
  drawTopbar(doc, 'Monthly Reports');

  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(11).text('Click on any month to see the detailed breakdown', 200, 75);

  // Grid / Split Screen
  // Left Column: Months list
  const listX = 200;
  const listW = 210;
  let itemY = 100;

  const monthsData = [
    { label: 'June 2026', inc: '₹53,500', exp: '₹18,500', active: true },
    { label: 'May 2026', inc: '₹47,200', exp: '₹22,100', active: false },
    { label: 'April 2026', inc: '₹51,000', exp: '₹19,000', active: false },
    { label: 'March 2026', inc: '₹49,000', exp: '₹17,800', active: false }
  ];

  monthsData.forEach(m => {
    // Card background
    doc.rect(listX, itemY, listW, 70).fill(theme.white);
    if (m.active) {
      doc.rect(listX, itemY, listW, 70).strokeColor(theme.primary).lineWidth(1.5).stroke();
    } else {
      doc.rect(listX, itemY, listW, 70).strokeColor(theme.borderLight).lineWidth(1).stroke();
    }

    doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(12).text(m.label, listX + 15, itemY + 12);
    
    // Details
    doc.fillColor(theme.success).font('Helvetica').fontSize(10).text('Income: ' + m.inc, listX + 15, itemY + 32);
    doc.fillColor(theme.danger).font('Helvetica').fontSize(10).text('Expense: ' + m.exp, listX + 15, itemY + 48);

    // Chevron representation
    doc.strokeColor(theme.textMuted).lineWidth(1.5);
    doc.moveTo(listX + listW - 20, itemY + 30).lineTo(listX + listW - 12, itemY + 35).lineTo(listX + listW - 20, itemY + 40).stroke();

    itemY += 80;
  });

  // Right Column: Month Detail panel
  const detailX = 425;
  const detailY = 100;
  const detailW = 340;
  const detailH = 430;

  doc.rect(detailX, detailY, detailW, detailH).fill(theme.white);
  doc.rect(detailX, detailY, detailW, detailH).strokeColor(theme.borderLight).lineWidth(1).stroke();

  // Detail Header
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(14).text('June 2026 Detailed Breakdown', detailX + 15, detailY + 18);
  
  // Download buttons mockup
  doc.rect(detailX + detailW - 130, detailY + 12, 50, 22).strokeColor(theme.border).lineWidth(1).stroke();
  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(9).text('CSV ⬇', detailX + detailW - 120, detailY + 18);

  doc.rect(detailX + detailW - 70, detailY + 12, 55, 22).strokeColor(theme.border).lineWidth(1).stroke();
  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(9).text('PDF 🖨', detailX + detailW - 61, detailY + 18);

  // Micro Summary strip in the detail panel
  const sumY = detailY + 50;
  doc.rect(detailX + 15, sumY, detailW - 30, 50).fill(theme.bg);
  doc.rect(detailX + 15, sumY, detailW - 30, 50).strokeColor(theme.borderLight).lineWidth(1).stroke();

  // Metrics
  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(8).text('INCOME', detailX + 25, sumY + 12);
  doc.fillColor(theme.success).font('Helvetica-Bold').fontSize(11).text('₹53,500', detailX + 25, sumY + 26);

  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(8).text('EXPENSES', detailX + 125, sumY + 12);
  doc.fillColor(theme.danger).font('Helvetica-Bold').fontSize(11).text('₹18,500', detailX + 125, sumY + 26);

  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(8).text('NET BAL', detailX + 225, sumY + 12);
  doc.fillColor(theme.primary).font('Helvetica-Bold').fontSize(11).text('₹35,000', detailX + 225, sumY + 26);

  // Sub-list: Transaction list in report
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(11).text('Transactions Summary:', detailX + 15, detailY + 115);
  
  const headersR = ['Date', 'Desc', 'Cat', 'Amt'];
  const rowsR = [
    ['Jun 19', 'Grocery Shopping', 'Food', '-₹2,450'],
    ['Jun 18', 'Monthly Salary', 'Salary', '+₹45,000'],
    ['Jun 15', 'Electricity Bill', 'Utilities', '-₹1,200'],
    ['Jun 12', 'Netflix', 'Entertain', '-₹649'],
    ['Jun 10', 'Freelance Web Design', 'Freelance', '+₹8,500'],
    ['Jun 08', 'Petrol Fuel', 'Transport', '-₹1,500'],
    ['Jun 05', 'Dinner Out', 'Food', '-₹1,850']
  ];
  
  drawTable(doc, detailX + 15, detailY + 130, detailW - 30, headersR, rowsR);

  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Page 4 of 8: Monthly Reports', 700, 585);
}

// ==========================================
// PAGE 5: YEARLY REPORTS
// ==========================================
function buildPage5(doc) {
  applyBackground(doc);
  drawSidebar(doc, 'Yearly Reports');
  drawTopbar(doc, 'Yearly Reports');

  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(11).text('Annual income & expense summary — click a year for full breakdown', 200, 75);

  // Year Selection Strip
  const tabY = 95;
  doc.rect(200, tabY, 565, 30).fill(theme.white).strokeColor(theme.borderLight).stroke();
  doc.roundedRect(205, tabY + 3, 70, 24, 3).fill(theme.primaryLight);
  doc.fillColor(theme.primary).font('Helvetica-Bold').fontSize(10).text('Year 2026', 215, tabY + 10);
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Year 2025', 295, tabY + 10);
  doc.fillColor(theme.textMuted).text('Year 2024', 375, tabY + 10);

  // Active Year Stats Row
  const cardsY = 135;
  drawCard(doc, 200, cardsY, 175, 75, 'Annual Income (2026)', '₹345,000.00', 'From 4 sources', 'success');
  drawCard(doc, 395, cardsY, 175, 75, 'Annual Expenses (2026)', '₹120,500.00', 'Across 12 categories', 'danger');
  drawCard(doc, 590, cardsY, 175, 75, 'Net Savings (2026)', '₹224,500.00', '65.0% saving rate', 'primary');

  // Month-by-month chart
  drawChartPlaceholder(doc, 200, 225, 320, 180, 'Monthly Savings Trend', 'line');

  // Monthly summary grid (mini-table)
  const detailGridY = 225;
  const detailGridW = 230;
  doc.rect(535, detailGridY, detailGridW, 180).fill(theme.white).strokeColor(theme.borderLight).stroke();
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(11).text('Monthly Aggregates', 550, detailGridY + 14);

  const headersY = ['Month', 'Income', 'Expense'];
  const rowsY = [
    ['January', '₹45,000', '₹15,200'],
    ['February', '₹48,000', '₹18,100'],
    ['March', '₹45,000', '₹14,900'],
    ['April', '₹51,000', '₹19,000'],
    ['May', '₹47,200', '₹22,100']
  ];
  drawTable(doc, 550, detailGridY + 34, detailGridW - 30, headersY, rowsY);

  // Category statistics at bottom
  const catY = 415;
  doc.rect(200, catY, 565, 115).fill(theme.white).strokeColor(theme.borderLight).stroke();
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(12).text('Annual Category Breakdown', 215, catY + 15);

  // Custom Category horizontal bars inside card
  const barY = catY + 40;
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(10).text('Rent & Utilities (45%)', 215, barY);
  doc.roundedRect(215, barY + 12, 140, 10, 5).fill(theme.borderLight);
  doc.roundedRect(215, barY + 12, 63, 10, 5).fill(theme.primary); // 45%

  doc.fillColor(theme.textSecondary).text('Food & Dining (25%)', 400, barY);
  doc.roundedRect(400, barY + 12, 140, 10, 5).fill(theme.borderLight);
  doc.roundedRect(400, barY + 12, 35, 10, 5).fill(theme.success); // 25%

  doc.fillColor(theme.textSecondary).text('Leisure & Shopping (18%)', 585, barY);
  doc.roundedRect(585, barY + 12, 140, 10, 5).fill(theme.borderLight);
  doc.roundedRect(585, barY + 12, 25, 10, 5).fill(theme.danger); // 18%

  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Page 5 of 8: Yearly Reports', 700, 585);
}

// ==========================================
// PAGE 6: ANALYTICS
// ==========================================
function buildPage6(doc) {
  applyBackground(doc);
  drawSidebar(doc, 'Analytics');
  drawTopbar(doc, 'Analytics');

  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(11).text('Deep insights into your financial patterns', 200, 75);

  // Row 1: Trend line charts
  drawChartPlaceholder(doc, 200, 100, 275, 210, 'Monthly Net Balance Trend', 'line');
  drawChartPlaceholder(doc, 490, 100, 275, 210, 'Income vs Expense (All Time)', 'bar');

  // Row 2: Category analytics (Horizontal bars, clean design)
  const breakdownY = 325;
  const breakdownW = 565;
  const breakdownH = 200;

  doc.rect(200, breakdownY, breakdownW, breakdownH).fill(theme.white).strokeColor(theme.borderLight).stroke();
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(14).text('Top Expense Categories (All Time)', 220, breakdownY + 20);

  // Category item list with horizontal bar gauges
  const categories = [
    { name: 'House Rent', amount: '₹1,50,000', percentage: 0.42, color: theme.primary },
    { name: 'Groceries & Food', amount: '₹89,200', percentage: 0.25, color: theme.success },
    { name: 'Utilities & Bills', amount: '₹42,800', percentage: 0.12, color: '#f59e0b' },
    { name: 'Travel & Transport', amount: '₹35,000', percentage: 0.10, color: theme.danger },
    { name: 'Streaming & Games', amount: '₹21,000', percentage: 0.06, color: '#8b5cf6' }
  ];

  let cY = breakdownY + 50;
  categories.forEach(c => {
    doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(10).text(c.name, 220, cY);
    doc.fillColor(theme.textMuted).font('Helvetica').text(c.amount + ` (${Math.round(c.percentage * 100)}%)`, 340, cY);
    
    // Bar
    const barX = 450;
    const barW = 280;
    doc.roundedRect(barX, cY - 2, barW, 10, 5).fill(theme.borderLight);
    doc.roundedRect(barX, cY - 2, barW * c.percentage, 10, 5).fill(c.color);

    cY += 26;
  });

  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Page 6 of 8: Analytics', 700, 585);
}

// ==========================================
// PAGE 7: INCOME SOURCE BALANCES
// ==========================================
function buildPage7(doc) {
  applyBackground(doc);
  drawSidebar(doc, 'Source Balances');
  drawTopbar(doc, 'Income Source Balances');

  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(11).text('Track exactly how much you\'ve earned, spent, and kept from each income stream', 200, 75);

  // Period selector
  const filterY = 95;
  doc.rect(200, filterY, 565, 45).fill(theme.white).strokeColor(theme.borderLight).stroke();
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(10).text('Period:', 215, filterY + 17);

  // Period Tabs
  doc.roundedRect(260, filterY + 10, 220, 25, 4).fill(theme.bg);
  doc.roundedRect(262, filterY + 12, 70, 21, 3).fill(theme.white);
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(9).text('All Time', 275, filterY + 18);
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(9).text('This Month', 348, filterY + 18);
  doc.fillColor(theme.textMuted).text('Custom', 420, filterY + 18);

  // Overall pot summary strip
  const stripY = 150;
  doc.rect(200, stripY, 565, 60).fill(theme.white).strokeColor(theme.borderLight).stroke();

  // Stat columns
  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(8).text('TOTAL EARNED', 215, stripY + 15);
  doc.fillColor(theme.success).font('Helvetica-Bold').fontSize(14).text('₹5,35,000', 215, stripY + 30);

  doc.strokeColor(theme.borderLight).lineWidth(1).moveTo(330, stripY + 10).lineTo(330, stripY + 50).stroke();

  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(8).text('TRACKED EXPENSES', 350, stripY + 15);
  doc.fillColor(theme.danger).font('Helvetica-Bold').fontSize(14).text('₹1,50,000', 350, stripY + 30);

  doc.strokeColor(theme.borderLight).lineWidth(1).moveTo(480, stripY + 10).lineTo(480, stripY + 50).stroke();

  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(8).text('UNTRACKED EXPENSES', 500, stripY + 15);
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(14).text('₹35,000', 500, stripY + 30);

  doc.strokeColor(theme.borderLight).lineWidth(1).moveTo(630, stripY + 10).lineTo(630, stripY + 50).stroke();

  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(8).text('NET POT AVAILABLE', 650, stripY + 15);
  doc.fillColor(theme.primary).font('Helvetica-Bold').fontSize(14).text('₹3,50,000', 650, stripY + 30);

  // Wallet balances grids (2 cards representing separate streams)
  const gridY = 225;
  const cardW = 270;
  const cardH = 260;

  // Wallet Card 1: Salary Stream
  doc.rect(200, gridY, cardW, cardH).fill(theme.white).strokeColor(theme.borderLight).stroke();
  doc.rect(200, gridY, cardW, 6).fill(theme.primary); // Blue top banner

  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(14).text('💼 Primary Salary Pot', 220, gridY + 25);
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Monthly regular income credit', 220, gridY + 42);

  // Financial status inside card
  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(11).text('Total Deposited:', 220, gridY + 75);
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').text('₹4,50,000', 330, gridY + 75);

  doc.fillColor(theme.textSecondary).font('Helvetica').text('Expenses Charged:', 220, gridY + 95);
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').text('₹1,00,000', 330, gridY + 95);

  // Remaining balance
  doc.rect(215, gridY + 120, cardW - 30, 45).fill(theme.successLight);
  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(10).text('Remaining Balance:', 230, gridY + 130);
  doc.fillColor(theme.success).font('Helvetica-Bold').fontSize(14).text('₹3,50,000', 230, gridY + 146);

  // Visual spent percentage bar
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(9).text('Spent Ratio (22%)', 220, gridY + 185);
  drawProgressBar(doc, 220, gridY + 198, cardW - 40, 0.22, theme.primary);

  // Wallet Card 2: Freelance Projects
  doc.rect(495, gridY, cardW, cardH).fill(theme.white).strokeColor(theme.borderLight).stroke();
  doc.rect(495, gridY, cardW, 6).fill(theme.success); // Green top banner

  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(14).text('💼 Freelancing Pot', 515, gridY + 25);
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Consulting & design gigs pot', 515, gridY + 42);

  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(11).text('Total Deposited:', 515, gridY + 75);
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').text('₹85,000', 625, gridY + 75);

  doc.fillColor(theme.textSecondary).font('Helvetica').text('Expenses Charged:', 515, gridY + 95);
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').text('₹50,000', 625, gridY + 95);

  // Remaining balance
  doc.rect(510, gridY + 120, cardW - 30, 45).fill(theme.successLight);
  doc.fillColor(theme.textSecondary).font('Helvetica').fontSize(10).text('Remaining Balance:', 525, gridY + 130);
  doc.fillColor(theme.success).font('Helvetica-Bold').fontSize(14).text('₹35,000', 525, gridY + 146);

  // Visual spent percentage bar
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(9).text('Spent Ratio (58%)', 515, gridY + 185);
  drawProgressBar(doc, 515, gridY + 198, cardW - 40, 0.58, theme.success);

  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Page 7 of 8: Source Balances', 700, 585);
}

// ==========================================
// PAGE 8: ADD TRANSACTION DIALOG OVERLAY
// ==========================================
function buildPage8(doc) {
  // 1. Draw Dashboard Overview in Background (grayed out)
  applyBackground(doc);
  drawSidebar(doc, 'Dashboard');
  
  // Custom draw Dashboard Overview but with muted/gray colors to look inactive
  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(18).text('Financial Overview', 200, 20);
  doc.roundedRect(670, 15, 100, 30, 4).fill(theme.border);
  doc.fillColor(theme.white).fontSize(11).text('+ Add Entry', 688, 24);

  // Inactive grey cards
  doc.rect(200, 100, 175, 80).fill(theme.white).strokeColor(theme.borderLight).stroke();
  doc.rect(395, 100, 175, 80).fill(theme.white).strokeColor(theme.borderLight).stroke();
  doc.rect(590, 100, 175, 80).fill(theme.white).strokeColor(theme.borderLight).stroke();
  
  // Grey charts placeholder
  doc.rect(200, 195, 565, 200).fill(theme.white).strokeColor(theme.borderLight).stroke();
  doc.fillColor(theme.textMuted).font('Helvetica-Bold').fontSize(12).text('Charts and tables below...', 220, 220);

  // 2. Dark Overlay over everything
  doc.rect(0, 0, 792, 612).fillColor('#090d16').fillOpacity(0.5).fill();
  doc.fillOpacity(1.0); // Reset opacity for modal

  // 3. Central Modal Window
  const mX = 266; // Centered
  const mY = 80;
  const mW = 260;
  const mH = 430;

  doc.roundedRect(mX, mY, mW, mH, 8).fill(theme.white);
  doc.rect(mX, mY, mW, mH).strokeColor(theme.border).lineWidth(1).stroke();

  // Modal Header
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(14).text('Add Transaction', mX + 20, mY + 22);
  
  // Close X
  doc.strokeColor(theme.textSecondary).lineWidth(1.5);
  doc.moveTo(mX + mW - 30, mY + 20).lineTo(mX + mW - 20, mY + 30).stroke();
  doc.moveTo(mX + mW - 20, mY + 20).lineTo(mX + mW - 30, mY + 30).stroke();

  // Type Toggle (Income / Expense)
  const toggleY = mY + 50;
  doc.roundedRect(mX + 20, toggleY, mW - 40, 32, 4).fill(theme.bg);
  // Income (active)
  doc.roundedRect(mX + 22, toggleY + 2, (mW - 44) / 2, 28, 3).fill(theme.white);
  doc.fillColor(theme.success).font('Helvetica-Bold').fontSize(10).text('Income Pot', mX + 45, toggleY + 11);
  // Expense
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Expense Pot', mX + 155, toggleY + 11);

  // Form Fields
  let fieldY = toggleY + 48;

  // Field 1: Amount
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(9).text('Amount (₹)', mX + 20, fieldY);
  doc.rect(mX + 20, fieldY + 12, mW - 40, 30).strokeColor(theme.border).stroke();
  doc.fillColor(theme.textPrimary).font('Helvetica-Bold').fontSize(11).text('45,000.00', mX + 30, fieldY + 22);

  fieldY += 56;

  // Field 2: Category
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(9).text('Category', mX + 20, fieldY);
  doc.rect(mX + 20, fieldY + 12, mW - 40, 30).strokeColor(theme.border).stroke();
  doc.fillColor(theme.textPrimary).font('Helvetica').fontSize(10).text('Salary Income Credit  v', mX + 30, fieldY + 22);

  fieldY += 56;

  // Field 3: Description
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(9).text('Description (optional)', mX + 20, fieldY);
  doc.rect(mX + 20, fieldY + 12, mW - 40, 30).strokeColor(theme.border).stroke();
  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('e.g. Monthly salary payout', mX + 30, fieldY + 22);

  fieldY += 56;

  // Field 4: Date
  doc.fillColor(theme.textSecondary).font('Helvetica-Bold').fontSize(9).text('Date', mX + 20, fieldY);
  doc.rect(mX + 20, fieldY + 12, mW - 40, 30).strokeColor(theme.border).stroke();
  doc.fillColor(theme.textPrimary).font('Helvetica').fontSize(10).text('2026-06-20', mX + 30, fieldY + 22);

  // Submit button
  doc.roundedRect(mX + 20, mY + 365, mW - 40, 38, 4).fill(theme.primary);
  doc.fillColor(theme.white).font('Helvetica-Bold').fontSize(11).text('Add Transaction', mX + 75, mY + 379);

  doc.fillColor(theme.textMuted).font('Helvetica').fontSize(10).text('Page 8 of 8: Add Modal Overlay', 700, 585);
}

// --- CONSTRUCT PDF ---

try {
  console.log('Generating Page 1: Auth & Landing...');
  buildPage1(doc);

  console.log('Generating Page 2: Dashboard Overview...');
  doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 0 });
  buildPage2(doc);

  console.log('Generating Page 3: Transactions Log...');
  doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 0 });
  buildPage3(doc);

  console.log('Generating Page 4: Monthly Reports...');
  doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 0 });
  buildPage4(doc);

  console.log('Generating Page 5: Yearly Reports...');
  doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 0 });
  buildPage5(doc);

  console.log('Generating Page 6: Analytics...');
  doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 0 });
  buildPage6(doc);

  console.log('Generating Page 7: Income Source Balances...');
  doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 0 });
  buildPage7(doc);

  console.log('Generating Page 8: Add Transaction Dialog Overlay...');
  doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 0 });
  buildPage8(doc);

  doc.end();
  console.log('PDF Generation Completed Successfully.');
} catch (err) {
  console.error('Error during PDF generation:', err);
  process.exit(1);
}
