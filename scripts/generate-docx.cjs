#!/usr/bin/env node
/**
 * generate-docx.js - Phase 3: Markdown → Docx変換
 * Usage: node generate-docx.js /tmp/manual-M1308/content.md /tmp/manual-M1308/materials.json
 */

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, Header, Footer, AlignmentType, LevelFormat,
  TableOfContents, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageBreak, PageNumber, TabStopType, TabStopPosition
} = require("docx");

// ==============================================================================
// Config
// ==============================================================================
const FONT_BODY = "MS 明朝";
const FONT_HEADING = "MS ゴシック";
const PAGE_WIDTH = 11906;   // A4 width in DXA
const PAGE_HEIGHT = 16838;  // A4 height in DXA
const MARGIN_TOP = 1440;    // 25mm ≈ 1 inch
const MARGIN_BOTTOM = 1440;
const MARGIN_LEFT = 1134;   // 20mm
const MARGIN_RIGHT = 1134;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 9638 DXA

const border = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

// ==============================================================================
// Markdown Parser
// ==============================================================================
function parseMarkdown(md) {
  // Preprocessing: clean up AI artifacts and markdown escapes
  md = md
    // Remove AI thinking/meta lines (e.g. "装置の構造を十分に把握できました...")
    .replace(/^.*(?:把握できました|確認できました|生成します|分析します|読み込みます|理解しました|調査します).*$/gm, "")
    // Strip blockquote prefix
    .replace(/^>\s?/gm, "")
    // Remove horizontal rules
    .replace(/^-{3,}$/gm, "")
    .replace(/^\\-{2,}/gm, "")
    // Remove escaped markdown (\# \*\* \- etc from pandoc round-trip)
    .replace(/\\#/g, "#")
    .replace(/\\\*/g, "*")
    // Remove code block fences that might wrap the entire output
    .replace(/^```(?:markdown)?\s*$/gm, "")
    // Clean up multiple blank lines
    .replace(/\n{3,}/g, "\n\n");

  const lines = md.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === "") { i++; continue; }

    // Heading
    const h1Match = line.match(/^## (.+)/);
    const h2Match = line.match(/^### (.+)/);
    const h3Match = line.match(/^#### (.+)/);

    if (h1Match) {
      elements.push({ type: "heading1", text: h1Match[1].trim() });
      i++; continue;
    }
    if (h2Match) {
      elements.push({ type: "heading2", text: h2Match[1].trim() });
      i++; continue;
    }
    if (h3Match) {
      elements.push({ type: "heading3", text: h3Match[1].trim() });
      i++; continue;
    }

    // Table
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableRows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim();
        // Skip separator rows (|---|---|)
        if (row.match(/^\|[\s-:|]+\|$/)) { i++; continue; }
        const cells = row.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim());
        tableRows.push(cells);
        i++;
      }
      if (tableRows.length > 0) {
        elements.push({ type: "table", rows: tableRows });
      }
      continue;
    }

    // Image placeholder
    const imgMatch = line.match(/\{\{IMAGE:(.+?)\}\}/);
    if (imgMatch) {
      elements.push({ type: "image", path: imgMatch[1].trim() });
      i++; continue;
    }

    // Warning labels
    // Warning labels - handle various formats: 【危険】, **【危 険】**, etc.
    const cleanLine = line.trim().replace(/\*\*/g, "");
    if (/【危\s*険】/.test(cleanLine)) {
      elements.push({ type: "warning", level: "danger", text: cleanLine.replace(/【危\s*険】/, "").trim() });
      i++; continue;
    }
    if (/【警\s*告】/.test(cleanLine)) {
      elements.push({ type: "warning", level: "warning", text: cleanLine.replace(/【警\s*告】/, "").trim() });
      i++; continue;
    }
    if (/【注\s*意】/.test(cleanLine)) {
      elements.push({ type: "warning", level: "caution", text: cleanLine.replace(/【注\s*意】/, "").trim() });
      i++; continue;
    }

    // Bullet list
    if (line.match(/^\s*[-*]\s/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\s*[-*]\s/)) {
        items.push(lines[i].replace(/^\s*[-*]\s/, "").trim());
        i++;
      }
      elements.push({ type: "list", items });
      continue;
    }

    // Numbered list
    if (line.match(/^\s*\d+[.)]\s/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\s*\d+[.)]\s/)) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s/, "").trim());
        i++;
      }
      elements.push({ type: "numbered_list", items });
      continue;
    }

    // Regular paragraph
    elements.push({ type: "paragraph", text: line.trim() });
    i++;
  }

  return elements;
}

// ==============================================================================
// Docx Element Builders
// ==============================================================================
function makeTextRuns(text) {
  // Handle **bold** and regular text
  const parts = text.split(/(\*\*.+?\*\*)/g);
  return parts.filter(p => p).map(part => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return new TextRun({ text: part.slice(2, -2), bold: true, font: FONT_BODY, size: 21 });
    }
    return new TextRun({ text: part, font: FONT_BODY, size: 21 });
  });
}

function makeHeading(text, level) {
  const sizes = { 1: 32, 2: 28, 3: 24 };
  const headingLevel = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
  return new Paragraph({
    heading: headingLevel[level],
    spacing: { before: level === 1 ? 360 : 240, after: 120 },
    children: [new TextRun({ text, bold: true, font: FONT_HEADING, size: sizes[level] })]
  });
}

function makeTable(rows) {
  if (rows.length === 0) return null;
  const numCols = Math.max(...rows.map(r => r.length));
  const colWidth = Math.floor(CONTENT_WIDTH / numCols);
  const columnWidths = Array(numCols).fill(colWidth);
  // Adjust last column for rounding
  columnWidths[numCols - 1] = CONTENT_WIDTH - colWidth * (numCols - 1);

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths,
    rows: rows.map((cells, rowIdx) => {
      const isHeader = rowIdx === 0;
      return new TableRow({
        children: cells.map((cell, colIdx) => new TableCell({
          borders,
          width: { size: columnWidths[colIdx] || colWidth, type: WidthType.DXA },
          margins: cellMargins,
          shading: isHeader ? { fill: "D5E8F0", type: ShadingType.CLEAR } : undefined,
          children: [new Paragraph({
            children: [new TextRun({
              text: cell || "",
              bold: isHeader,
              font: isHeader ? FONT_HEADING : FONT_BODY,
              size: 20
            })]
          })]
        }))
      });
    })
  });
}

function makeWarning(level, text) {
  const colors = { danger: "FFD7D7", warning: "FFFACD", caution: "E8F5E8" };
  const labels = { danger: "【危 険】", warning: "【警 告】", caution: "【注 意】" };
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    shading: { fill: colors[level], type: ShadingType.CLEAR },
    indent: { left: 360, right: 360 },
    children: [
      new TextRun({ text: labels[level] + " ", bold: true, font: FONT_HEADING, size: 21, color: level === "danger" ? "CC0000" : level === "warning" ? "CC6600" : "006600" }),
      new TextRun({ text, font: FONT_BODY, size: 21 })
    ]
  });
}

function makeImage(imgPath, materials) {
  // Resolve image path
  let fullPath = imgPath;
  if (imgPath === "assembly_drawing" && materials.assembly_drawing) {
    fullPath = materials.assembly_drawing;
  } else if (!path.isAbsolute(imgPath) && materials.project_folder) {
    fullPath = path.join(materials.project_folder, imgPath);
  }

  if (!fs.existsSync(fullPath)) {
    return new Paragraph({
      children: [new TextRun({ text: `[画像: ${imgPath} - ファイルが見つかりません]`, italics: true, font: FONT_BODY, size: 21, color: "999999" })]
    });
  }

  try {
    const imgData = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase().replace(".", "");
    const imgType = ext === "jpg" ? "jpeg" : ext;

    // Scale to fit page width (max 500px width, maintain aspect)
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 120 },
      children: [new ImageRun({
        type: imgType,
        data: imgData,
        transformation: { width: 500, height: 350 },
        altText: { title: imgPath, description: imgPath, name: imgPath }
      })]
    });
  } catch (e) {
    return new Paragraph({
      children: [new TextRun({ text: `[画像読み込みエラー: ${imgPath}]`, italics: true, font: FONT_BODY, size: 21, color: "CC0000" })]
    });
  }
}

// ==============================================================================
// Cover Page
// ==============================================================================
function makeCoverPage(materials) {
  return [
    new Paragraph({ spacing: { before: 3600 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [new TextRun({ text: "取 扱 説 明 書", bold: true, font: FONT_HEADING, size: 52 })]
    }),
    new Paragraph({ spacing: { after: 200 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [new TextRun({ text: materials.device_name, bold: true, font: FONT_HEADING, size: 36 })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: `装置番号: ${materials.device_number}`, font: FONT_HEADING, size: 28 })]
    }),
    new Paragraph({ spacing: { after: 1200 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: materials.customer_formal || materials.customer, font: FONT_HEADING, size: 28 })]
    }),
    new Paragraph({ spacing: { after: 1200 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: materials.manufacturer, font: FONT_HEADING, size: 24 })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: materials.date, font: FONT_HEADING, size: 24 })]
    }),
    new Paragraph({ children: [new PageBreak()] })
  ];
}

// ==============================================================================
// Main Build
// ==============================================================================
async function main() {
  const contentPath = process.argv[2];
  const materialsPath = process.argv[3];

  if (!contentPath || !materialsPath) {
    console.error("Usage: node generate-docx.js <content.md> <materials.json>");
    process.exit(1);
  }

  const content = fs.readFileSync(contentPath, "utf-8");
  const materials = JSON.parse(fs.readFileSync(materialsPath, "utf-8"));
  const elements = parseMarkdown(content);

  console.log(`Parsed ${elements.length} elements from markdown`);

  // Build document children
  const coverChildren = makeCoverPage(materials);

  // TOC
  const tocChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "目次", bold: true, font: FONT_HEADING, size: 32 })]
    }),
    new TableOfContents("目次", { hyperlink: true, headingStyleRange: "1-3" }),
    new Paragraph({ children: [new PageBreak()] })
  ];

  // Content
  const contentChildren = [];
  const bulletConfig = {
    reference: "bullets",
    levels: [{
      level: 0, format: LevelFormat.BULLET, text: "•",
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } }
    }]
  };
  // numberConfig removed - dynamic per-group configs used instead

  let numberGroupId = 0;
  for (const el of elements) {
    switch (el.type) {
      case "heading1":
        // Page break before each chapter (## 1. ...)
        if (el.text.match(/^\d+\./)) {
          contentChildren.push(new Paragraph({ children: [new PageBreak()] }));
        }
        contentChildren.push(makeHeading(el.text, 1));
        break;

      case "heading2":
        contentChildren.push(makeHeading(el.text, 2));
        break;

      case "heading3":
        contentChildren.push(makeHeading(el.text, 3));
        break;

      case "table": {
        const tbl = makeTable(el.rows);
        if (tbl) contentChildren.push(tbl);
        break;
      }

      case "warning":
        contentChildren.push(makeWarning(el.level, el.text));
        break;

      case "image":
        contentChildren.push(makeImage(el.path, materials));
        break;

      case "list":
        for (const item of el.items) {
          contentChildren.push(new Paragraph({
            numbering: { reference: "bullets", level: 0 },
            children: makeTextRuns(item)
          }));
        }
        break;

      case "numbered_list":
        numberGroupId++;
        for (const item of el.items) {
          contentChildren.push(new Paragraph({
            numbering: { reference: `numbers_${numberGroupId}`, level: 0 },
            children: makeTextRuns(item)
          }));
        }
        break;

      case "paragraph":
        contentChildren.push(new Paragraph({
          spacing: { after: 100 },
          children: makeTextRuns(el.text)
        }));
        break;
    }
  }

  // Build document
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT_BODY, size: 21 } }
      },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 32, bold: true, font: FONT_HEADING },
          paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 }
        },
        {
          id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 28, bold: true, font: FONT_HEADING },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 }
        },
        {
          id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, font: FONT_HEADING },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 }
        }
      ]
    },
    numbering: { config: [
      bulletConfig,
      // Generate unique number configs per list group (restart from 1)
      ...Array.from({ length: numberGroupId }, (_, i) => ({
        reference: `numbers_${i + 1}`,
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }))
    ] },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT, right: MARGIN_RIGHT }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({
              text: `${materials.device_number} ${materials.device_name} 取扱説明書`,
              font: FONT_HEADING, size: 16, color: "888888"
            })]
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "- ", font: FONT_BODY, size: 18 }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT_BODY, size: 18 }),
              new TextRun({ text: " -", font: FONT_BODY, size: 18 })
            ]
          })]
        })
      },
      children: [...coverChildren, ...tocChildren, ...contentChildren]
    }]
  });

  // Output
  const outDir = path.dirname(contentPath);
  const docxName = `${materials.device_number}_取扱説明書.docx`;
  const outPath = path.join(outDir, docxName);

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Docx生成完了: ${outPath} (${Math.round(buffer.length / 1024)}KB)`);
}

main().catch(e => { console.error("ERROR:", e); process.exit(1); });
