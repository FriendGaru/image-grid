"use strict";

// The single source of truth: every successfully decoded image, in order.
// Each entry: { file, url, element, width, height, rotation, copies }
const images = [];

// The most times one image can be repeated in the output.
const MAX_COPIES = 99;

// The fewest times one image can be repeated. 0 means "skip this image".
const MIN_COPIES = 0;

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const statusText = document.getElementById("status");
const clearButton = document.getElementById("clear-button");
const thumbnailList = document.getElementById("thumbnail-list");

// Tries to load and decode one file. Resolves to an image entry,
// or to null if the browser can't decode it.
async function loadImage(file) {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.src = url;

    try {
        await element.decode(); // Rejects if the image is corrupt or unsupported.
    } catch (error) {
        URL.revokeObjectURL(url); // Don't leak the URL for a file we're discarding.
        return null;
    }

    // Some SVGs have no intrinsic size and report 0x0. We can't scale those
    // meaningfully yet, so treat them as unusable.
    if (element.naturalWidth === 0 || element.naturalHeight === 0) {
        URL.revokeObjectURL(url);
        return null;
    }

    return {
        file: file,
        url: url,
        element: element,
        width: element.naturalWidth,
        height: element.naturalHeight,
        rotation: 0, // clockwise degrees: 0, 90, 180, or 270
        copies: 1,   // how many cells this image fills in the output
    };
}

// How many cells the images fill in total, counting copies.
function countCells(list) {
    return list.reduce((sum, image) => sum + image.copies, 0);
}

// Repeats each image `copies` times, keeping the original order: A A A B B C.
function expandCopies(list) {
    const cells = [];
    for (const image of list) {
        for (let n = 0; n < image.copies; n++) {
            cells.push(image);
        }
    }
    return cells;
}

// Accepts a FileList (from the picker or a drop) and adds the images to our list.
async function addFiles(fileList) {
    const files = Array.from(fileList);

    // Only reject files that explicitly claim to be something other than an image.
    // An empty type is common for newer formats, so those get a decode attempt.
    const looksLikeImage = (file) => file.type === "" || file.type.startsWith("image/");
    const candidates = files.filter(looksLikeImage);
    const skippedNames = files.filter((file) => !looksLikeImage(file)).map((file) => file.name);

    statusText.textContent = `Loading ${candidates.length} image(s)...`;

    // Start every load at once, then wait for all of them.
    // Promise.all keeps results in the original order.
    const results = await Promise.all(candidates.map(loadImage));

    results.forEach((result, i) => {
        if (result) {
            images.push(result);
        } else {
            skippedNames.push(candidates[i].name);
        }
    });

    renderThumbnails();
    updateStatus(skippedNames);
}

function removeImage(index) {
    URL.revokeObjectURL(images[index].url);
    images.splice(index, 1);
    renderThumbnails();
    updateStatus();
}

function clearImages() {
    for (const image of images) {
        URL.revokeObjectURL(image.url);
    }
    images.length = 0;
    clearOutputs();
    renderThumbnails();
    updateStatus();
}

// An image's size after rotation: at 90° and 270°, width and height trade places.
function getRotatedSize(image) {
    return image.rotation % 180 === 0
        ? { width: image.width, height: image.height }
        : { width: image.height, height: image.width };
}

// Rebuilds the thumbnail list from the images array.
function renderThumbnails() {
    thumbnailList.textContent = ""; // Empties the container.

    images.forEach((image, index) => {
        const card = document.createElement("div");
        card.className = "thumbnail";

        const img = document.createElement("img");
        img.src = image.url;
        img.alt = image.file.name;

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = image.file.name;
        name.title = image.file.name; // Full name on hover, since it may be truncated.

        const size = document.createElement("div");
        size.className = "size";

        // Shows the rotation on the thumbnail and in the size text.
        const showRotation = () => {
            img.style.transform = `rotate(${image.rotation}deg)`;
            const rotated = getRotatedSize(image);
            size.textContent = `${rotated.width} × ${rotated.height}` +
                (image.rotation ? ` · ${image.rotation}°` : "");
        };
        showRotation();

        const makeRotateButton = (symbol, label, step) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = symbol;
            button.title = label;
            button.setAttribute("aria-label", `${label}: ${image.file.name}`);
            button.addEventListener("click", () => {
                image.rotation = (image.rotation + step + 360) % 360;
                showRotation();   // update in place, so keyboard focus stays on the button
                updateStaleNote();
            });
            return button;
        };

        const controls = document.createElement("div");
        controls.className = "rotate-controls";
        controls.append(
            makeRotateButton("↺", "Rotate left", -90),
            makeRotateButton("↻", "Rotate right", 90)
        );

        const copiesLabel = document.createElement("label");
        copiesLabel.className = "copies";
        copiesLabel.append("Copies ");

        const copiesInput = document.createElement("input");
        copiesInput.type = "number";
        copiesInput.min = String(MIN_COPIES);
        copiesInput.max = String(MAX_COPIES);
        copiesInput.step = "1";
        copiesInput.value = String(image.copies);
        copiesInput.setAttribute("aria-label", `Copies of ${image.file.name}`);

        const skipNote = document.createElement("span");
        skipNote.className = "skip-note";
        skipNote.textContent = "Skipped";

        // Dims the card and shows "Skipped" when the image has 0 copies.
        const showSkipped = () => {
            card.classList.toggle("skipped", image.copies === 0);
            skipNote.hidden = image.copies !== 0;
        };
        showSkipped();

        copiesInput.addEventListener("input", () => {
            const number = copiesInput.valueAsNumber; // NaN if empty or invalid
            const valid = Number.isInteger(number) && number >= MIN_COPIES && number <= MAX_COPIES;
            copiesInput.classList.toggle("invalid", !valid);

            if (valid) {
                image.copies = number;
                showSkipped();
                updateSummary();
                updateStaleNote();
            }
        });

        // When the user leaves the field, show the value that's actually in use.
        copiesInput.addEventListener("change", () => {
            copiesInput.value = String(image.copies);
            copiesInput.classList.remove("invalid");
        });

        copiesLabel.append(copiesInput);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove";
        remove.textContent = "×";
        remove.title = "Remove this image";
        remove.addEventListener("click", () => removeImage(index));

        card.append(img, name, size, controls, copiesLabel, skipNote, remove);
        thumbnailList.append(card);
    });

    updateSummary();
    updateStaleNote();
}

function updateStatus(skippedNames = []) {
    let message = images.length === 1
        ? "1 image loaded."
        : `${images.length} images loaded.`;

    if (skippedNames.length > 0) {
        const shown = skippedNames.slice(0, 5).join(", ");
        const more = skippedNames.length > 5 ? `, and ${skippedNames.length - 5} more` : "";
        message += ` Could not read ${skippedNames.length} file${skippedNames.length === 1 ? "" : "s"}: ${shown}${more}.`;
    }
    statusText.textContent = message;
}

// --- Settings ---
const settingsSection = document.getElementById("settings-section");
const settingsSummary = document.getElementById("settings-summary");
const settingsError = document.getElementById("settings-error");

const MM_PER_INCH = 25.4;

function mmToPixels(mm, dpi) {
    return Math.round(mm * dpi / MM_PER_INCH);
}

function pixelsToMm(px, dpi) {
    return px * MM_PER_INCH / dpi;
}

// Fields that are always whole numbers, whatever the unit.
const numberFields = {
    columns: { input: document.getElementById("columns"), label: "Columns", min: 1, max: 50 },
    rows:    { input: document.getElementById("rows"),    label: "Rows",    min: 1, max: 50 },
    dpi:     { input: document.getElementById("dpi"),     label: "Print resolution (DPI)", min: 72, max: 1200 },
};

// Fields measured in the user's chosen unit. Each unit has its own range.
// Pixel values must be whole numbers; millimeter values may have decimals.
const sizeFields = {
    cellWidth: {
        input: document.getElementById("cell-width"), label: "Cell width",
        px: { min: 1, max: 5000, step: 1 }, mm: { min: 1, max: 1000, step: 0.1 },
    },
    cellHeight: {
        input: document.getElementById("cell-height"), label: "Cell height",
        px: { min: 1, max: 5000, step: 1 }, mm: { min: 1, max: 1000, step: 0.1 },
    },
    borderWidth: {
        input: document.getElementById("border-width"), label: "Border width",
        px: { min: 0, max: 50, step: 1 }, mm: { min: 0, max: 20, step: 0.05 },
    },
};

const paperMessage = document.getElementById("paper-message");

// Standard paper sizes in millimeters, listed as short side × long side.
const PAPER_SIZES = {
    a5:      { label: "A5",         short: 148,   long: 210 },
    a4:      { label: "A4",         short: 210,   long: 297 },
    a3:      { label: "A3",         short: 297,   long: 420 },
    b6:      { label: "B6",         short: 125,   long: 176 },
    b5:      { label: "B5",         short: 176,   long: 250 },
    b4:      { label: "B4",         short: 250,   long: 353 },
    b3:      { label: "B3",         short: 353,   long: 500 },
    jisb6:   { label: "JIS B6",     short: 128,   long: 182 },
    jisb5:   { label: "JIS B5",     short: 182,   long: 257 },
    jisb4:   { label: "JIS B4",     short: 257,   long: 364 },
    jisb3:   { label: "JIS B3",     short: 364,   long: 515 },
    letter:  { label: "US Letter",  short: 215.9, long: 279.4 },
    legal:   { label: "US Legal",   short: 215.9, long: 355.6 },
    tabloid: { label: "US Tabloid", short: 279.4, long: 431.8 },
};

// Paper-related number fields (all in millimeters).
const paperFields = {
    margin:      { input: document.getElementById("margin"),        label: "Margin",              min: 0,  max: 100 },
    customSide1: { input: document.getElementById("custom-side-1"), label: "Custom paper side 1", min: 50, max: 2000 },
    customSide2: { input: document.getElementById("custom-side-2"), label: "Custom paper side 2", min: 50, max: 2000 },
};

// Input properties are strings in the browser's type definitions, so we convert explicitly.
for (const field of Object.values(numberFields)) {
    field.input.min = String(field.min);
    field.input.max = String(field.max);
    field.input.step = "1";
}

for (const field of Object.values(paperFields)) {
    field.input.min = String(field.min);
    field.input.max = String(field.max);
    field.input.step = "0.1";
}

// Returns the paper's { width, height } in mm for the chosen size and
// orientation, or null when the user doesn't want a paper check.
function getPaperMm(paper, orientation, side1, side2) {
    if (paper === "none") {
        return null;
    }
    const sides = paper === "custom"
        ? [side1, side2]
        : [PAPER_SIZES[paper].short, PAPER_SIZES[paper].long];
    const short = Math.min(...sides);
    const long = Math.max(...sides);
    return orientation === "landscape"
        ? { width: long, height: short }
        : { width: short, height: long };
}

// The last known-good settings, always in PIXELS. Drawing code reads this.
const settings = {};

let currentUnit = "px";

function getSelectedUnit() {
    return document.querySelector('input[name="unit"]:checked').value;
}

// Applies the right min/max/step to the size inputs and updates the unit labels.
function applyUnitLimits(unit) {
    for (const field of Object.values(sizeFields)) {
        field.input.min = String(field[unit].min);
        field.input.max = String(field[unit].max);
        field.input.step = String(field[unit].step);
    }
    for (const span of document.querySelectorAll(".unit-name")) {
        span.textContent = unit === "mm" ? "millimeters" : "pixels";
    }
}

// When the unit changes, rewrite the size fields so the physical size stays
// the same. Uses the last valid settings (which are in pixels).
function convertFieldsToUnit(unit) {
    if (settings.dpi === undefined) {
        return; // Nothing valid to convert yet.
    }
    for (const [key, field] of Object.entries(sizeFields)) {
        const px = settings[key];
        field.input.value = unit === "mm"
            ? String(Number(pixelsToMm(px, settings.dpi).toFixed(2)))
            : String(px);
    }
}

// Reads every control and validates it. Returns pixel values and any errors.
function readSettings() {
    const values = {};
    const errors = [];
    const raw = {}; // size fields as typed, in the chosen unit
    const unit = getSelectedUnit();

    values.unit = unit;

    // Whole-number fields: columns, rows, DPI.
    for (const [key, field] of Object.entries(numberFields)) {
        const number = field.input.valueAsNumber; // NaN if empty or invalid
        const valid = Number.isInteger(number) && number >= field.min && number <= field.max;

        field.input.classList.toggle("invalid", !valid);

        if (valid) {
            values[key] = number;
        } else {
            errors.push(`${field.label} must be a whole number from ${field.min} to ${field.max}.`);
        }
    }

    // Size fields: validated in the chosen unit.
    for (const [key, field] of Object.entries(sizeFields)) {
        const range = field[unit];
        const number = field.input.valueAsNumber;
        const valid = Number.isFinite(number) &&
            number >= range.min && number <= range.max &&
            (unit === "mm" || Number.isInteger(number));

        field.input.classList.toggle("invalid", !valid);

        if (valid) {
            raw[key] = number;
        } else {
            const unitName = unit === "mm" ? "millimeters" : "pixels";
            const kind = unit === "mm" ? "number" : "whole number";
            errors.push(`${field.label} must be a ${kind} from ${range.min} to ${range.max} ${unitName}.`);
        }
    }

    // Paper and margin. The custom sides only matter for custom paper.
    values.paper = document.getElementById("paper-size").value;
    values.orientation = document.querySelector('input[name="orientation"]:checked').value;

    for (const [key, field] of Object.entries(paperFields)) {
        const needed = key === "margin" || values.paper === "custom";
        if (!needed) {
            field.input.classList.remove("invalid");
            continue;
        }

        const number = field.input.valueAsNumber;
        const valid = Number.isFinite(number) && number >= field.min && number <= field.max;
        field.input.classList.toggle("invalid", !valid);

        if (valid) {
            values[key] = number;
        } else {
            errors.push(`${field.label} must be a number from ${field.min} to ${field.max} millimeters.`);
        }
    }

    if (errors.length === 0) {
        values.paperMm = getPaperMm(values.paper, values.orientation, values.customSide1, values.customSide2);
        if (values.paperMm &&
            2 * values.margin >= Math.min(values.paperMm.width, values.paperMm.height)) {
            errors.push("The margins leave no room to print on this paper.");
        }
    }

    // Convert to pixels (needs a valid DPI and valid size fields).
    if (errors.length === 0) {
        for (const key of Object.keys(sizeFields)) {
            let px = unit === "mm" ? mmToPixels(raw[key], values.dpi) : raw[key];
            if (raw[key] > 0 && px < 1) {
                px = 1; // A border you asked for never rounds away to nothing.
            }
            values[key] = px;
        }
    }

    // Individually valid numbers can still combine into a canvas that's too big.
    if (errors.length === 0) {
        const size = getCanvasSize(values);
        if (size.width > MAX_CANVAS_SIDE ||
            size.height > MAX_CANVAS_SIDE ||
            size.width * size.height > MAX_CANVAS_AREA) {
            errors.push(
                `That would make an output image of ${size.width} × ${size.height} pixels, ` +
                `which is too large for browsers to draw reliably. Reduce the cell size, columns, rows, or DPI.`
            );
        }
    }

    values.fitMode = document.querySelector('input[name="fitMode"]:checked').value;
    values.borderColor = document.getElementById("border-color").value;
    values.backgroundColor = document.getElementById("background-color").value;
    values.borderEmptyCells = document.getElementById("border-empty").checked;
    values.borderTarget = document.querySelector('input[name="borderTarget"]:checked').value;

    return { values, errors };
}

function onSettingsChange() {
    document.getElementById("custom-paper").hidden =
        document.getElementById("paper-size").value !== "custom";

    const unit = getSelectedUnit();

    applyUnitLimits(unit);
    if (unit !== currentUnit) {
        convertFieldsToUnit(unit);
        currentUnit = unit;
    }

    const { values, errors } = readSettings();

    // Only accept the new values if every field is valid.
    if (errors.length === 0) {
        Object.assign(settings, values);
    }

    settingsError.textContent = errors.join(" ");
    settingsValid = errors.length === 0;
    updateSummary();
    updateGenerateButton();
    updateStaleNote();
}

// Describes the current settings, including real-world print sizes.
function updateSummary() {
    const s = settings;
    const cellsPerImage = s.columns * s.rows;
    const size = getCanvasSize(s);
    const mm = (px) => pixelsToMm(px, s.dpi).toFixed(1);

    const lines = [
        `Each cell holds ${s.cellWidth} × ${s.cellHeight} px, which prints at ` +
        `${mm(s.cellWidth)} × ${mm(s.cellHeight)} mm at ${s.dpi} DPI.`,
        `Each output image is ${size.width} × ${size.height} px, printing at ` +
        `${mm(size.width)} × ${mm(size.height)} mm.`,
    ];

    const gridText = `${s.columns} × ${s.rows} grid (${cellsPerImage} cells per output image)`;

    if (images.length === 0) {
        lines.push(`Each output image will hold a ${gridText}.`);
    } else {
        const totalCells = countCells(images);

        if (totalCells === 0) {
            lines.push("Every image is set to 0 copies, so there is nothing to output.");
        } else {
            const outputCount = Math.ceil(totalCells / cellsPerImage);
            const emptyCells = outputCount * cellsPerImage - totalCells;
            const cellsText = totalCells === images.length
                ? ""
                : ` (${totalCells} cells, counting copies)`;

            lines.push(
                `${images.length} image${images.length === 1 ? "" : "s"}${cellsText} in a ${gridText} ` +
                `will produce ${outputCount} output image${outputCount === 1 ? "" : "s"}` +
                (emptyCells > 0
                    ? `, with ${emptyCells} empty cell${emptyCells === 1 ? "" : "s"} in the last one.`
                    : ".")
            );
        }
    }

    settingsSummary.textContent = lines.join(" ");
    updatePaperCheck();
}

// Compares one output image's printed size with the paper's printable area.
function updatePaperCheck() {
    const s = settings;
    paperMessage.className = "";

    if (!s.paperMm) {
        paperMessage.textContent = "";
        return;
    }

    const fmt = (n) => n.toFixed(1);
    const size = getCanvasSize(s);
    const outW = pixelsToMm(size.width, s.dpi);
    const outH = pixelsToMm(size.height, s.dpi);
    const availW = s.paperMm.width - 2 * s.margin;
    const availH = s.paperMm.height - 2 * s.margin;
    const EPSILON = 0.01; // Guards against floating-point noise.

    const paperName = s.paper === "custom" ? "your custom paper" : PAPER_SIZES[s.paper].label;
    const paperText = `${paperName} (${s.orientation})`;
    const printable = `${fmt(availW)} × ${fmt(availH)} mm printable area after ${s.margin} mm margins`;
    const outputText = `${fmt(outW)} × ${fmt(outH)} mm`;

    if (outW <= availW + EPSILON && outH <= availH + EPSILON) {
        paperMessage.className = "ok";
        paperMessage.textContent =
            `✔ Fits: each output image (${outputText}) fits within the ${printable} on ${paperText}.`;
        return;
    }

    paperMessage.className = "warn";
    let text = `⚠ Too large: each output image is ${outputText}, but ${paperText} has only a ${printable}.`;

    // Would rotating the paper help?
    if (outW <= availH + EPSILON && outH <= availW + EPSILON) {
        const other = s.orientation === "portrait" ? "landscape" : "portrait";
        text += ` It would fit in ${other} orientation.`;
    }

    // Largest cell that fits, worked out in whole pixels, then shown in mm.
    const availPxW = Math.floor(availW * s.dpi / MM_PER_INCH);
    const availPxH = Math.floor(availH * s.dpi / MM_PER_INCH);
    const maxCellPxW = Math.floor((availPxW - (s.columns + 1) * s.borderWidth) / s.columns);
    const maxCellPxH = Math.floor((availPxH - (s.rows + 1) * s.borderWidth) / s.rows);

    if (maxCellPxW >= 1 && maxCellPxH >= 1) {
        // Round down to 0.1 mm so the suggestion can never round back over the limit.
        const floorMm = (px) => (Math.floor(pixelsToMm(px, s.dpi) * 10) / 10).toFixed(1);
        text += ` With your current columns, rows, and borders, cells up to ` +
            `${floorMm(maxCellPxW)} × ${floorMm(maxCellPxH)} mm would fit.`;
    } else {
        text += " The borders alone take up too much room for this many columns and rows.";
    }

    paperMessage.textContent = text;
}

// One listener for the whole section: "input" events bubble up from every control.
settingsSection.addEventListener("input", onSettingsChange);

// Swaps the Columns and Rows fields, then re-reads the form.
document.getElementById("swap-button").addEventListener("click", () => {
    const columnsInput = numberFields.columns.input;
    const rowsInput = numberFields.rows.input;

    [columnsInput.value, rowsInput.value] = [rowsInput.value, columnsInput.value];

    // Setting .value from code doesn't fire "input", so trigger the update ourselves.
    onSettingsChange();
});

// --- Drawing ---

// Browsers limit canvas size, and the limits vary. These are conservative
// values that should work in all modern browsers.
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 100000000;

// Pixel size of one output image: cell interiors plus the shared border lines.
function getCanvasSize(s) {
    return {
        width: s.columns * s.cellWidth + (s.columns + 1) * s.borderWidth,
        height: s.rows * s.cellHeight + (s.rows + 1) * s.borderWidth,
    };
}

// Works out where the (rotated) image lands for the cell at (x, y).
// Draws nothing. Returns two rectangles, in canvas coordinates:
//   visible (dx, dy, dw, dh): the area where the image shows
//   full    (fx, fy, fw, fh): the whole scaled image, which in Cover mode is
//                             larger than the cell and gets clipped
function getFitRects(image, x, y, w, h, fitMode) {
    const rotated = getRotatedSize(image);

    if (fitMode === "stretch") {
        return { dx: x, dy: y, dw: w, dh: h, fx: x, fy: y, fw: w, fh: h };
    }

    if (fitMode === "contain") {
        const scale = Math.min(w / rotated.width, h / rotated.height);
        const dw = Math.round(rotated.width * scale);
        const dh = Math.round(rotated.height * scale);
        // Center it. Rounding keeps edges on whole pixels so they stay crisp.
        const dx = x + Math.round((w - dw) / 2);
        const dy = y + Math.round((h - dh) / 2);
        return { dx: dx, dy: dy, dw: dw, dh: dh, fx: dx, fy: dy, fw: dw, fh: dh };
    }

    // "cover": scale until the cell is filled; the overflow gets clipped.
    const scale = Math.max(w / rotated.width, h / rotated.height);
    const fw = rotated.width * scale;
    const fh = rotated.height * scale;
    return {
        dx: x, dy: y, dw: w, dh: h,
        fx: x + (w - fw) / 2, fy: y + (h - fh) / 2, fw: fw, fh: fh,
    };
}

// Exact transformation matrices (a, b, c, d) for each rotation. Written out by
// hand instead of using Math.cos/sin, which would leave tiny rounding errors.
const ROTATION_MATRICES = {
    0:   [1, 0, 0, 1],
    90:  [0, 1, -1, 0],
    180: [-1, 0, 0, -1],
    270: [0, -1, 1, 0],
};

// Draws one image, rotated, into the rectangles from getFitRects.
function drawRotatedImage(ctx, image, rects) {
    const [a, b, c, d] = ROTATION_MATRICES[image.rotation];

    // Size of the image in its own, unrotated frame (swapped at 90° and 270°).
    const sideways = image.rotation % 180 !== 0;
    const w = sideways ? rects.fh : rects.fw;
    const h = sideways ? rects.fw : rects.fh;

    ctx.save(); // so the clip and transform don't leak into later drawing

    // Only paint inside the visible rectangle (matters for Cover).
    ctx.beginPath();
    ctx.rect(rects.dx, rects.dy, rects.dw, rects.dh);
    ctx.clip();

    // Move the origin to the middle of the image's spot, rotate, then draw
    // the image centered on that origin.
    ctx.setTransform(a, b, c, d, rects.fx + rects.fw / 2, rects.fy + rects.fh / 2);
    ctx.drawImage(image.element, -w / 2, -h / 2, w, h);

    ctx.restore();
}

// Draws up to (columns × rows) images onto a new canvas and returns it.
function drawGrid(pageImages, s) {
    const b = s.borderWidth;
    const size = getCanvasSize(s);

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error(
            "The browser could not create an image this large. " +
            "Try smaller cells, fewer columns or rows, or a lower DPI."
        );
    }
    ctx.imageSmoothingQuality = "high";

    // Start with a solid background so transparent areas aren't black.
    ctx.fillStyle = s.backgroundColor;
    ctx.fillRect(0, 0, size.width, size.height);

    for (let i = 0; i < s.columns * s.rows; i++) {
        const image = pageImages[i]; // undefined for an empty cell

        if (!image && !s.borderEmptyCells) {
            continue; // Leave this cell blank, with no border of its own.
        }

        const column = i % s.columns;
        const row = Math.floor(i / s.columns);

        // Top-left corner of this cell's interior (skipping the border lines).
        const x = b + column * (s.cellWidth + b);
        const y = b + row * (s.cellHeight + b);

        // Work out where the image will land (if there is one).
        const rects = image
            ? getFitRects(image, x, y, s.cellWidth, s.cellHeight, s.fitMode)
            : null;

        // The "box" is the rectangle that receives the border: the image's
        // visible area, or the whole cell (always the cell, for empty cells).
        const box = (rects && s.borderTarget === "image")
            ? { x: rects.dx, y: rects.dy, w: rects.dw, h: rects.dh }
            : { x: x, y: y, w: s.cellWidth, h: s.cellHeight };

        // Border: a larger rectangle in the border color...
        if (b > 0) {
            ctx.fillStyle = s.borderColor;
            ctx.fillRect(box.x - b, box.y - b, box.w + 2 * b, box.h + 2 * b);
        }

        // ...then the interior on top, leaving only the border ring visible.
        ctx.fillStyle = s.backgroundColor;
        ctx.fillRect(box.x, box.y, box.w, box.h);

        if (rects) {
            drawRotatedImage(ctx, image, rects);
        }
    }

    return canvas;
}

// --- Writing the print resolution into PNG files ---

// CRC-32 checksum, which the PNG format requires on every chunk.
// The lookup table is built once, when the script loads.
const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// Builds a complete pHYs chunk (21 bytes) for the given DPI.
function makePhysChunk(dpi) {
    const pixelsPerMeter = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21); // 4 length + 4 type + 9 data + 4 CRC
    const view = new DataView(chunk.buffer); // DataView writes big-endian by default, as PNG requires

    view.setUint32(0, 9);                   // length of the data
    chunk.set([0x70, 0x48, 0x59, 0x73], 4); // the letters "pHYs"
    view.setUint32(8, pixelsPerMeter);      // horizontal
    view.setUint32(12, pixelsPerMeter);     // vertical
    chunk[16] = 1;                          // unit: meters
    view.setUint32(17, crc32(chunk.subarray(4, 17))); // checksum of type + data

    return chunk;
}

// Returns a copy of a PNG blob with the print resolution recorded in it.
// If the data doesn't look like a PNG, returns the original untouched.
async function addPngDpi(blob, dpi) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);

    const isPng = bytes.length > 8 && bytes[0] === 0x89 &&
        bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    if (!isPng) {
        return blob;
    }

    const parts = [bytes.subarray(0, 8)]; // the signature
    let pos = 8;

    while (pos + 12 <= bytes.length) {
        const length = view.getUint32(pos);
        const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
        const end = pos + 12 + length; // length field + type + data + CRC

        if (type !== "pHYs") {
            parts.push(bytes.subarray(pos, end)); // keep every chunk except an old pHYs
        }
        if (type === "IHDR") {
            parts.push(makePhysChunk(dpi)); // our chunk goes right after the header
        }
        pos = end;
    }

    return new Blob(parts, { type: "image/png" });
}

// --- Generating all output images ---

const generateButton = document.getElementById("generate-button");
const outputMessage = document.getElementById("output-message");
const outputList = document.getElementById("output-list");

// Every generated page, as a compact PNG.
// Each entry: { blob, url, width, height, dpi, filename, firstImage, lastImage }
// (firstImage and lastImage are cell numbers, counting copies.)
const outputs = [];

let generating = false;

const staleNote = document.getElementById("stale-note");
const generateHint = document.getElementById("generate-hint");

let settingsValid = true;
let generatedSignature = null; // what the current outputs were built from

// A string describing everything that affects the drawn pixels.
function getSignature(s, list) {
    return JSON.stringify([
        s.cellWidth, s.cellHeight, s.columns, s.rows, s.fitMode,
        s.borderWidth, s.borderColor, s.backgroundColor,
        s.borderEmptyCells, s.borderTarget, s.dpi,
        list.map((image) => [image.url, image.rotation, image.copies]),
    ]);
}

// Shows the warning when the current form no longer matches the outputs.
function updateStaleNote() {
    staleNote.hidden = outputs.length === 0 ||
        generatedSignature === getSignature(settings, images);
}

// The Generate button is off while a run is in progress or the settings are invalid.
function updateGenerateButton() {
    generateButton.disabled = generating || !settingsValid;
    generateHint.textContent = (!generating && !settingsValid)
        ? "Fix the highlighted settings first."
        : "";
}

// Encodes a canvas as a PNG. toBlob uses a callback, so we wrap it in a Promise.
function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error("The browser could not encode the image as a PNG."));
            }
        }, "image/png");
    });
}

// Lets the browser repaint (for example, the progress message) before we continue.
function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function formatBytes(bytes) {
    return bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const downloadAllButton = document.getElementById("download-all-button");

// Saves one output as a file by clicking a temporary link.
function downloadOutput(output) {
    const link = document.createElement("a");
    link.href = output.url;
    link.download = output.filename;
    document.body.append(link); // Some browsers require the link to be in the page.
    link.click();
    link.remove();
}

function pause(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

downloadAllButton.addEventListener("click", async () => {
    downloadAllButton.disabled = true;
    for (const output of outputs) {
        downloadOutput(output);
        await pause(400); // Spacing keeps browsers from blocking the burst.
    }
    downloadAllButton.disabled = false;
});

// Releases every output's blob URL and empties the output area.
function clearOutputs() {
    for (const output of outputs) {
        URL.revokeObjectURL(output.url);
    }
    outputs.length = 0;
    outputList.textContent = "";
    downloadAllButton.hidden = true;
    generatedSignature = null;
    staleNote.hidden = true;
}

// Adds one page's heading, details, download button, and preview to the page.
function renderOutputCard(output, index, total) {
    const card = document.createElement("div");
    card.className = "output-card";

    const heading = document.createElement("h3");
    heading.textContent = `Output image ${index + 1} of ${total}`;

    const details = document.createElement("p");
    const range = output.firstImage === output.lastImage
        ? `Cell ${output.firstImage}`
        : `Cells ${output.firstImage}–${output.lastImage}`;
    details.textContent =
        `${range} · ${output.width} × ${output.height} px · ${output.dpi} DPI · ${formatBytes(output.blob.size)}`;

    const download = document.createElement("button");
    download.type = "button";
    download.className = "download";
    download.textContent = `Download ${output.filename}`;
    download.addEventListener("click", () => downloadOutput(output));

    const img = document.createElement("img");
    img.src = output.url;
    img.alt = `Output image ${index + 1} of ${total}`;

    card.append(heading, details, download, img);
    outputList.append(card);
}

generateButton.addEventListener("click", async () => {
    if (generating) {
        return;
    }

    clearOutputs();

    if (images.length === 0) {
        outputMessage.textContent = "Add at least one image first.";
        return;
    }

    if (countCells(images) === 0) {
        outputMessage.textContent = "Every image is set to 0 copies. Raise at least one copy count first.";
        return;
    }

    generating = true;
    updateGenerateButton();

    // Snapshots: one run uses one consistent set of settings and images,
    // even if the user changes things while it's running.
    const s = { ...settings };
    const list = images.map((image) => ({ ...image })); // copies each entry, so later rotations or copy counts can't leak in
    generatedSignature = getSignature(s, list);

    const cells = expandCopies(list); // every cell to fill, repeats included
    const perPage = s.columns * s.rows;
    const pageCount = Math.ceil(cells.length / perPage);

    try {
        for (let page = 0; page < pageCount; page++) {
            outputMessage.textContent = `Generating output image ${page + 1} of ${pageCount}...`;
            await nextFrame(); // Let the message appear before the heavy work starts.

            const first = page * perPage;
            const pageImages = cells.slice(first, first + perPage);

            const canvas = drawGrid(pageImages, s);
            const width = canvas.width;
            const height = canvas.height;
            const rawBlob = await canvasToBlob(canvas);
            const blob = await addPngDpi(rawBlob, s.dpi);

            // Shrinking the canvas to nothing tells the browser it can free the pixels now.
            canvas.width = 0;
            canvas.height = 0;

            const digits = Math.max(2, String(pageCount).length);
            const output = {
                blob: blob,
                url: URL.createObjectURL(blob),
                width: width,
                height: height,
                dpi: s.dpi,
                filename: `grid-${String(page + 1).padStart(digits, "0")}.png`,
                firstImage: first + 1,
                lastImage: first + pageImages.length,
            };
            outputs.push(output);
            renderOutputCard(output, page, pageCount);
        }

        const copiesText = cells.length === list.length
            ? ""
            : ` (${cells.length} cells, counting copies)`;
        outputMessage.textContent =
            `Done: ${pageCount} output image${pageCount === 1 ? "" : "s"} from ${list.length} input image${list.length === 1 ? "" : "s"}${copiesText}.`;
    } catch (error) {
        console.error(error);
        outputMessage.textContent = `Something went wrong: ${error.message}`;
    } finally {
        // Runs whether we succeeded or failed, so the button never stays stuck.
        generating = false;
        updateGenerateButton();
        updateStaleNote();
        downloadAllButton.hidden = outputs.length < 2;
    }
});

// --- File picker ---
fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    // Reset so choosing the same file again still triggers a "change" event.
    fileInput.value = "";
});

// --- Drag and drop ---
dropZone.addEventListener("dragover", (event) => {
    event.preventDefault(); // Required, or the browser won't allow a drop here.
    dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", (event) => {
    // Ignore the event if the pointer merely moved onto a child element.
    if (!dropZone.contains(event.relatedTarget)) {
        dropZone.classList.remove("drag-over");
    }
});

dropZone.addEventListener("drop", (event) => {
    event.preventDefault(); // Stops the browser from opening the file.
    dropZone.classList.remove("drag-over");
    addFiles(event.dataTransfer.files);
});

// If a file is dropped *outside* the drop zone, browsers navigate to it and
// the user loses their work. Block that everywhere on the page.
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

// --- Clear ---
clearButton.addEventListener("click", clearImages);

// --- Start up ---
updateStatus();
onSettingsChange(); // Read the initial form values so `settings` is populated.