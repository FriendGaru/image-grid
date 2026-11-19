"use strict";

// The single source of truth: every successfully decoded image, in order.
// Each entry: { file, url, element, width, height, rotation, copies }
const images = [];

// How many times one image can be repeated in the output.
// 0 means "skip this image".
const MIN_COPIES = 0;
const MAX_COPIES = 99;

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
// An image with 0 copies adds nothing, so it is skipped.
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
        img.alt = ""; // the button around it carries the label

        // The picture is a button: clicking it (or pressing Enter on it) opens the preview.
        const open = document.createElement("button");
        open.type = "button";
        open.className = "thumb-button";
        open.title = "View full image";
        open.setAttribute("aria-label", `View full image: ${image.file.name}`);
        open.addEventListener("click", () => openLightbox(index));
        open.append(img);

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

        card.append(open, name, size, controls, copiesLabel, skipNote, remove);
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

// --- Fixed cell ratio: the elements and limits ---
//
// The ratio is stored once, as a pair (width : height), in `ratioPair`. The boxes
// on the page are views of it: the "one number" box shows width ÷ height. Typing
// one number n stores the pair n : 1.
//
// With the ratio ON, the boxes are editable and the cell size follows them.
// With the ratio OFF, the boxes are read-only and show the cell's current shape.

const MIN_RATIO = 0.02;       // 1 : 50
const MAX_RATIO = 50;         // 50 : 1
const RATIO_PART_MIN = 0.01;  // limits for each number in "4 : 3"
const RATIO_PART_MAX = 1000;

const fixedRatioInput = document.getElementById("fixed-ratio");
const ratioSingleInput = document.getElementById("ratio-single");

const ratioFields = {
    ratioWidth:  { input: document.getElementById("ratio-width"),  label: "Ratio width part",  min: RATIO_PART_MIN, max: RATIO_PART_MAX },
    ratioHeight: { input: document.getElementById("ratio-height"), label: "Ratio height part", min: RATIO_PART_MIN, max: RATIO_PART_MAX },
};

const allRatioInputs = [ratioSingleInput, ratioFields.ratioWidth.input, ratioFields.ratioHeight.input];

ratioSingleInput.min = String(MIN_RATIO);
ratioSingleInput.max = String(MAX_RATIO);
for (const field of Object.values(ratioFields)) {
    field.input.min = String(field.min);
    field.input.max = String(field.max);
}
for (const input of allRatioInputs) {
    input.step = "any"; // any decimal is fine, such as 1.3333
}

// The stored ratio. The page's ratio boxes are views of this.
let ratioPair = { width: 4, height: 3 };

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

// --- Fixed cell ratio: the behavior ---

function getRatioMode() {
    return document.querySelector('input[name="ratioMode"]:checked').value; // "single" or "pair"
}

// When the ratio changes: which size stays put? "height" or "width".
function getRatioKeep() {
    return document.querySelector('input[name="ratioKeep"]:checked').value;
}

// Greatest common divisor, used to reduce 400 : 300 to 4 : 3.
function gcd(a, b) {
    while (b) {
        [a, b] = [b, a % b];
    }
    return a;
}

// The whole number `value` becomes when multiplied by `scale`, or null if it isn't one.
// (Tolerates floating-point noise, such as 53.33 × 100 = 5333.000000000001.)
function toWhole(value, scale) {
    const scaled = Math.round(value * scale);
    return Math.abs(scaled - value * scale) < 1e-6 ? scaled : null;
}

// Pixel sizes are whole numbers; millimeter sizes get 2 decimals.
function roundSize(value, unit) {
    return unit === "mm" ? Number(value.toFixed(2)) : Math.round(value);
}

const ratioValue = (pair) => pair.width / pair.height;

const isRatioInRange = (ratio) => Number.isFinite(ratio) && ratio >= MIN_RATIO && ratio <= MAX_RATIO;

const isRatioPartInRange = (part) => Number.isFinite(part) && part >= RATIO_PART_MIN && part <= RATIO_PART_MAX;

// A pair is usable when both numbers and the ratio between them are in range.
function isUsableRatioPair(pair) {
    return isRatioPartInRange(pair.width) && isRatioPartInRange(pair.height) &&
        isRatioInRange(ratioValue(pair));
}

// The ratio typed into the boxes now in use, or null if it isn't usable.
function readTypedRatio() {
    if (getRatioMode() === "single") {
        const number = ratioSingleInput.valueAsNumber;
        return isRatioInRange(number) ? { width: number, height: 1 } : null;
    }
    const pair = {
        width: ratioFields.ratioWidth.input.valueAsNumber,
        height: ratioFields.ratioHeight.input.valueAsNumber,
    };
    return isUsableRatioPair(pair) ? pair : null;
}

// Writes a ratio into all three boxes, except `exceptInput` (the one being typed in).
function showRatio(pair, exceptInput = null) {
    const views = [
        [ratioFields.ratioWidth.input, String(pair.width)],
        [ratioFields.ratioHeight.input, String(pair.height)],
        [ratioSingleInput, String(Number(ratioValue(pair).toFixed(4)))],
    ];
    for (const [input, text] of views) {
        if (input !== exceptInput) {
            input.value = text;
        }
    }
}

// The ratio of a width and height as a pair: reduced if they are whole numbers
// (400 × 300 gives 4 : 3), otherwise "number : 1".
function deriveRatioPair(width, height) {
    const scale = getSelectedUnit() === "mm" ? 100 : 1; // millimeters have 2 decimals
    const w = toWhole(width, scale);
    const h = toWhole(height, scale);

    if (w !== null && h !== null) {
        const divisor = gcd(w, h);
        const pair = { width: w / divisor, height: h / divisor };
        if (isRatioPartInRange(pair.width) && isRatioPartInRange(pair.height)) {
            return pair;
        }
    }
    return { width: Number((width / height).toFixed(4)), height: 1 };
}

// With the ratio off, the boxes show the cell's current shape.
function showCurrentShape() {
    const width = sizeFields.cellWidth.input.valueAsNumber;
    const height = sizeFields.cellHeight.input.valueAsNumber;
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        ratioPair = deriveRatioPair(width, height);
        showRatio(ratioPair);
    }
}

// Applies the stored ratio to the cell size after the ratio itself changed:
// the chosen size stays, and the other follows.
function applyRatioToSizes() {
    if (!isUsableRatioPair(ratioPair)) {
        return; // the form will flag the ratio
    }
    const ratio = ratioValue(ratioPair);
    const unit = getSelectedUnit();
    const widthInput = sizeFields.cellWidth.input;
    const heightInput = sizeFields.cellHeight.input;
    const width = widthInput.valueAsNumber;
    const height = heightInput.valueAsNumber;

    if (getRatioKeep() === "height") {
        if (Number.isFinite(height) && height > 0) {
            widthInput.value = String(roundSize(height * ratio, unit));
        }
    } else if (Number.isFinite(width) && width > 0) {
        heightInput.value = String(roundSize(width / ratio, unit));
    }
}

// Keeps the ratio and cell size linked after the user edits `source`.
// Runs before validation, so the checks see the updated fields.
function syncRatioAfterEdit(source) {
    const widthInput = sizeFields.cellWidth.input;
    const heightInput = sizeFields.cellHeight.input;

    if (source.name === "ratioMode") {
        showRatio(ratioPair); // switching views changes nothing but what is displayed
        return;
    }

    if (!fixedRatioInput.checked) {
        // Ratio off: the boxes just show the cell's current shape.
        if (source === widthInput || source === heightInput || source === fixedRatioInput) {
            showCurrentShape();
        }
        return;
    }

    // Ratio on from here.
    if (source === widthInput || source === heightInput) {
        if (!isUsableRatioPair(ratioPair)) {
            return;
        }
        const ratio = ratioValue(ratioPair);
        const unit = getSelectedUnit();
        const width = widthInput.valueAsNumber;
        const height = heightInput.valueAsNumber;

        if (source === widthInput && Number.isFinite(width) && width > 0) {
            heightInput.value = String(roundSize(width / ratio, unit));
        } else if (source === heightInput && Number.isFinite(height) && height > 0) {
            widthInput.value = String(roundSize(height * ratio, unit));
        }
        return;
    }

    if (allRatioInputs.includes(source)) {
        const typed = readTypedRatio();
        if (typed === null) {
            return; // not usable yet (empty, or out of range); the form will flag it
        }
        ratioPair = typed;
        showRatio(ratioPair, source); // update the other boxes, not the one being typed in
        applyRatioToSizes();
    }
    // Ticking the box on needs nothing: the boxes already show the current shape.
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

    // Fixed cell ratio. The stored pair is always the value in use. While the ratio
    // is off its boxes only display the cell's shape, so there is nothing to check.
    values.fixedRatio = fixedRatioInput.checked;
    values.ratioMode = getRatioMode();
    values.ratioKeep = getRatioKeep();
    values.ratioWidth = ratioPair.width;
    values.ratioHeight = ratioPair.height;
    values.ratio = values.fixedRatio ? ratioValue(ratioPair) : null;

    for (const input of allRatioInputs) {
        input.classList.remove("invalid");
    }

    if (values.fixedRatio) {
        if (values.ratioMode === "single") {
            const valid = isRatioInRange(ratioSingleInput.valueAsNumber);
            ratioSingleInput.classList.toggle("invalid", !valid);
            if (!valid) {
                errors.push(`Ratio must be a number from ${MIN_RATIO} to ${MAX_RATIO}.`);
            }
        } else {
            let partsValid = true;
            for (const field of Object.values(ratioFields)) {
                const valid = isRatioPartInRange(field.input.valueAsNumber);
                field.input.classList.toggle("invalid", !valid);
                if (!valid) {
                    partsValid = false;
                    errors.push(`${field.label} must be a number from ${field.min} to ${field.max}.`);
                }
            }
            if (partsValid) {
                const typedRatio = ratioFields.ratioWidth.input.valueAsNumber /
                    ratioFields.ratioHeight.input.valueAsNumber;
                if (!isRatioInRange(typedRatio)) {
                    ratioFields.ratioWidth.input.classList.add("invalid");
                    ratioFields.ratioHeight.input.classList.add("invalid");
                    errors.push(`The ratio must be between ${MIN_RATIO} (1 : 50) and ${MAX_RATIO} (50 : 1).`);
                }
            }
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
        if (isCanvasTooLarge(size)) {
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
    // Show only the ratio boxes for the chosen way of entering it.
    const pairMode = getRatioMode() === "pair";
    document.getElementById("ratio-single-group").hidden = pairMode;
    document.getElementById("ratio-pair-group").hidden = !pairMode;

    // The ratio boxes are editable only while the ratio is on.
    const ratioOn = fixedRatioInput.checked;
    for (const input of allRatioInputs) {
        input.readOnly = !ratioOn;
    }
    document.getElementById("ratio-keep-group").hidden = !ratioOn;
    document.getElementById("swap-ratio-button").disabled = !ratioOn;

    const keep = getRatioKeep();
    document.getElementById("ratio-note").textContent = ratioOn
        ? `Editing the width changes the height, and the other way round. ` +
        `Changing the ratio keeps the ${keep} and changes the ${keep === "height" ? "width" : "height"}.`
        : "These boxes show the cell's current shape. Tick the box to keep that shape fixed.";

    document.getElementById("custom-paper").hidden =
        document.getElementById("paper-size").value !== "custom";

    const unit = getSelectedUnit();

    applyUnitLimits(unit);
    if (unit !== currentUnit) {
        convertFieldsToUnit(unit);
        currentUnit = unit;
        if (!ratioOn) {
            showCurrentShape(); // the converted sizes may differ slightly
        }
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

    // Whole pixels can't always match the ratio exactly. Say so when it's noticeable.
    if (s.fixedRatio && s.ratio) {
        const actual = s.cellWidth / s.cellHeight;
        if (Math.abs(actual - s.ratio) / s.ratio > 0.01) {
            lines.push(
                `Whole pixels can't match the ratio exactly: the actual cell shape is ` +
                `${Number(actual.toFixed(4))}, and the requested ratio is ${Number(s.ratio.toFixed(4))}.`
            );
        }
    }

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
settingsSection.addEventListener("input", (event) => {
    syncRatioAfterEdit(event.target); // updates linked values first, so validation sees them
    onSettingsChange();
});

// Swaps the Columns and Rows fields, then re-reads the form.
document.getElementById("swap-button").addEventListener("click", () => {
    const columnsInput = numberFields.columns.input;
    const rowsInput = numberFields.rows.input;

    [columnsInput.value, rowsInput.value] = [rowsInput.value, columnsInput.value];

    // Setting .value from code doesn't fire "input", so trigger the update ourselves.
    onSettingsChange();
});

// Swaps the cell's width and height. With the ratio on, the shape is turned on its
// side, so the ratio flips too: 4 : 3 becomes 3 : 4 and the cell stays consistent.
document.getElementById("swap-size-button").addEventListener("click", () => {
    const widthInput = sizeFields.cellWidth.input;
    const heightInput = sizeFields.cellHeight.input;

    [widthInput.value, heightInput.value] = [heightInput.value, widthInput.value];

    if (fixedRatioInput.checked) {
        ratioPair = { width: ratioPair.height, height: ratioPair.width };
        showRatio(ratioPair);
    } else {
        showCurrentShape();
    }
    onSettingsChange();
});

// Flips the ratio (4 : 3 becomes 3 : 4). Like any ratio change, the chosen size
// stays and the other follows. The button is disabled while the ratio is off.
document.getElementById("swap-ratio-button").addEventListener("click", () => {
    ratioPair = { width: ratioPair.height, height: ratioPair.width };
    showRatio(ratioPair);
    applyRatioToSizes();
    onSettingsChange();
});

// --- Saving settings ---

const SETTINGS_FILE_FORMAT = "image-grid-settings";
const SETTINGS_FILE_VERSION = 1;

// The default for every setting, in the units the form shows. The loader
// uses these for anything missing or invalid in a file, and the form is
// filled from them at startup.
const DEFAULT_SETTINGS = {
    unit: "px",
    dpi: 300,
    cellWidth: 300,
    cellHeight: 300,
    columns: 3,
    rows: 3,
    fixedRatio: false,
    ratioMode: "pair",
    ratioWidth: 4,
    ratioHeight: 3,
    ratioKeep: "height",
    fitMode: "stretch",
    borderWidth: 2,
    borderColor: "#000000",
    backgroundColor: "#ffffff",
    borderEmptyCells: false,
    borderTarget: "cell",
    paper: "a4",
    customSide1: 210,
    customSide2: 297,
    orientation: "portrait",
    margin: 10,
};

const presetNameInput = document.getElementById("preset-name");
const presetMessage = document.getElementById("preset-message");
const presetWarnings = document.getElementById("preset-warnings");

// Reads every control as the user sees it (in their chosen unit, not pixels).
// Only call this when the settings are valid.
function getFormValues() {
    // The custom paper sides aren't validated unless "Custom" is selected,
    // so they might hold junk. Fall back to the defaults if they do.
    const numberOrDefault = (input, fallback) =>
        Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : fallback;

    // While the ratio is off, the stored pair is just the cell's shape, which can be
    // extreme. Save the default instead of something the loader would reject.
    const ratioToSave = isUsableRatioPair(ratioPair)
        ? ratioPair
        : { width: DEFAULT_SETTINGS.ratioWidth, height: DEFAULT_SETTINGS.ratioHeight };

    return {
        unit: getSelectedUnit(),
        dpi: numberFields.dpi.input.valueAsNumber,
        cellWidth: sizeFields.cellWidth.input.valueAsNumber,
        cellHeight: sizeFields.cellHeight.input.valueAsNumber,
        columns: numberFields.columns.input.valueAsNumber,
        rows: numberFields.rows.input.valueAsNumber,
        fixedRatio: fixedRatioInput.checked,
        ratioMode: getRatioMode(),
        ratioWidth: ratioToSave.width,
        ratioHeight: ratioToSave.height,
        ratioKeep: getRatioKeep(),
        fitMode: document.querySelector('input[name="fitMode"]:checked').value,
        borderWidth: sizeFields.borderWidth.input.valueAsNumber,
        borderColor: document.getElementById("border-color").value,
        backgroundColor: document.getElementById("background-color").value,
        borderEmptyCells: document.getElementById("border-empty").checked,
        borderTarget: document.querySelector('input[name="borderTarget"]:checked').value,
        paper: document.getElementById("paper-size").value,
        customSide1: numberOrDefault(paperFields.customSide1.input, DEFAULT_SETTINGS.customSide1),
        customSide2: numberOrDefault(paperFields.customSide2.input, DEFAULT_SETTINGS.customSide2),
        orientation: document.querySelector('input[name="orientation"]:checked').value,
        margin: paperFields.margin.input.valueAsNumber,
    };
}

// Turns a preset name into a safe filename (without the extension).
// Keeps letters and digits from any language; replaces anything else that
// operating systems might reject.
function makeSafeFilename(name) {
    const cleaned = name
        .replace(/[^\p{L}\p{N} ._()-]/gu, "-")
        .replace(/\s+/g, " ")
        .replace(/^[\s.]+|[\s.]+$/g, "") // no leading or trailing spaces or dots
        .slice(0, 80)
        .trim();
    return cleaned || "grid-settings";
}

// Saves text as a file by clicking a temporary link.
function downloadTextFile(text, filename) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();

    // Revoking right away can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

document.getElementById("save-settings-button").addEventListener("click", () => {
    presetMessage.className = "";
    presetWarnings.textContent = ""; // clear any warnings from an earlier load

    if (!settingsValid) {
        presetMessage.className = "error";
        presetMessage.textContent = "Fix the problem shown in the settings first, then save.";
        return;
    }

    const name = presetNameInput.value.trim();
    const filename = makeSafeFilename(name) + ".json";

    const file = {
        format: SETTINGS_FILE_FORMAT,
        version: SETTINGS_FILE_VERSION,
        name: name,
        settings: getFormValues(),
    };

    // The "null, 2" makes the JSON indented, so people can read and edit it.
    downloadTextFile(JSON.stringify(file, null, 2), filename);

    presetMessage.textContent =
        `Saved as ${filename}. It is in your browser's download location; ` +
        `move it to your presets folder if you keep one.`;
});

// --- Loading settings ---

const MAX_SETTINGS_FILE_BYTES = 1024 * 1024; // real files are under 1 KB
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const loadSettingsInput = document.getElementById("load-settings-input");

const isPlainObject = (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isNumberInRange = (value, min, max) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const isWholeNumberInRange = (value, min, max) =>
    Number.isInteger(value) && value >= min && value <= max;

function unitWord(unit) {
    return unit === "mm" ? "millimeters" : "pixels";
}

// --- The rule for every setting ---
// valid(value, unit): is this value acceptable?
// requirement(unit):  the sentence used in the warning when it isn't.

function wholeNumberRule(field) {
    return {
        label: field.label,
        valid: (value) => isWholeNumberInRange(value, field.min, field.max),
        requirement: () => `is not a whole number from ${field.min} to ${field.max}`,
    };
}

// Cell size and border width: the allowed range depends on the unit.
function sizeRule(field) {
    return {
        label: field.label,
        valid: (value, unit) => unit === "mm"
            ? isNumberInRange(value, field.mm.min, field.mm.max)
            : isWholeNumberInRange(value, field.px.min, field.px.max),
        requirement: (unit) =>
            `is not a ${unit === "mm" ? "number" : "whole number"} from ` +
            `${field[unit].min} to ${field[unit].max} ${unitWord(unit)}`,
    };
}

// Margin and custom paper sides are always in millimeters.
function millimeterRule(field) {
    return {
        label: field.label,
        valid: (value) => isNumberInRange(value, field.min, field.max),
        requirement: () => `is not a number from ${field.min} to ${field.max} millimeters`,
    };
}

// A plain number in a range, with no unit.
function plainNumberRule(field) {
    return {
        label: field.label,
        valid: (value) => isNumberInRange(value, field.min, field.max),
        requirement: () => `is not a number from ${field.min} to ${field.max}`,
    };
}

function choiceRule(label, choices) {
    return {
        label: label,
        valid: (value) => choices.includes(value),
        requirement: () => `is not one of: ${choices.join(", ")}`,
    };
}

function colorRule(label) {
    return {
        label: label,
        valid: (value) => typeof value === "string" && COLOR_PATTERN.test(value),
        requirement: () => "is not a color like #1a2b3c",
    };
}

function booleanRule(label) {
    return {
        label: label,
        valid: (value) => typeof value === "boolean",
        requirement: () => "is not true or false",
    };
}

const SETTING_RULES = {
    unit:             choiceRule("Units", ["px", "mm"]),
    dpi:              wholeNumberRule(numberFields.dpi),
    cellWidth:        sizeRule(sizeFields.cellWidth),
    cellHeight:       sizeRule(sizeFields.cellHeight),
    columns:          wholeNumberRule(numberFields.columns),
    rows:             wholeNumberRule(numberFields.rows),
    fixedRatio:       booleanRule("Fixed ratio"),
    ratioMode:        choiceRule("Ratio entry", ["single", "pair"]),
    ratioWidth:       plainNumberRule(ratioFields.ratioWidth),
    ratioHeight:      plainNumberRule(ratioFields.ratioHeight),
    ratioKeep:        choiceRule("Ratio change keeps", ["height", "width"]),
    fitMode:          choiceRule("Fit mode", ["stretch", "contain", "cover"]),
    borderWidth:      sizeRule(sizeFields.borderWidth),
    borderColor:      colorRule("Border color"),
    backgroundColor:  colorRule("Background color"),
    borderEmptyCells: booleanRule("Borders around empty cells"),
    borderTarget:     choiceRule("Border placement", ["cell", "image"]),
    paper:            choiceRule("Paper size", ["none", "custom", ...Object.keys(PAPER_SIZES)]),
    customSide1:      millimeterRule(paperFields.customSide1),
    customSide2:      millimeterRule(paperFields.customSide2),
    orientation:      choiceRule("Orientation", ["portrait", "landscape"]),
    margin:           millimeterRule(paperFields.margin),
};

// The default for one setting. Default sizes are stored in pixels, so when
// the file uses millimeters we convert to the same physical size.
function getDefaultFor(key, unit, dpi) {
    const value = DEFAULT_SETTINGS[key];
    if (unit === "mm" && key in sizeFields) {
        return Number(pixelsToMm(value, dpi).toFixed(2));
    }
    return value;
}

// Formats a value for a warning message, with its unit where it has one.
function formatSetting(key, value, unit) {
    let text = JSON.stringify(value);
    if (text === undefined) {
        text = String(value);
    }
    if (text.length > 30) {
        text = text.slice(0, 30) + "…";
    }
    if (typeof value === "number") {
        if (key in sizeFields) {
            text += ` ${unit}`;
        } else if (key === "margin" || key.startsWith("customSide")) {
            text += " mm";
        } else if (key === "dpi") {
            text += " DPI";
        }
    }
    return text;
}

// Checks the settings from a file. Returns a complete, valid set of values
// plus a list of warnings describing everything that was substituted or ignored.
function checkLoadedSettings(rawSettings) {
    const values = {};
    const warnings = [];

    // Keys are checked in DEFAULT_SETTINGS order: unit first, then DPI,
    // because the other fields are validated in that unit.
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        const rule = SETTING_RULES[key];
        const present = Object.hasOwn(rawSettings, key);
        const raw = rawSettings[key];

        if (present && rule.valid(raw, values.unit)) {
            values[key] = raw;
            continue;
        }

        const fallback = getDefaultFor(
            key,
            values.unit ?? DEFAULT_SETTINGS.unit,
            values.dpi ?? DEFAULT_SETTINGS.dpi
        );
        values[key] = fallback;
        const fallbackText = formatSetting(key, fallback, values.unit);

        if (!present) {
            warnings.push(`${rule.label}: not in the file; used the default, ${fallbackText}.`);
        } else {
            let text = `${rule.label}: the file has ${formatSetting(key, raw, values.unit)}, ` +
                `which ${rule.requirement(values.unit)}; used the default, ${fallbackText}.`;
            if (key === "unit") {
                text += " Sizes in the file are read as pixels.";
            }
            warnings.push(text);
        }
    }

    // Combined check 1: two valid numbers can still make a ratio that's too extreme.
    if (values.fixedRatio) {
        const ratio = values.ratioWidth / values.ratioHeight;
        if (!isRatioInRange(ratio)) {
            warnings.push(
                `Ratio: ${Number(ratio.toFixed(4))} is outside ${MIN_RATIO} to ${MAX_RATIO}; ` +
                `used the default ratio, ${DEFAULT_SETTINGS.ratioWidth} : ${DEFAULT_SETTINGS.ratioHeight}.`
            );
            values.ratioWidth = DEFAULT_SETTINGS.ratioWidth;
            values.ratioHeight = DEFAULT_SETTINGS.ratioHeight;
        }
    }

    // Combined check 2: with a fixed ratio, the cell size has to match it.
    // If it doesn't, the size the file says to keep stays, and the other is recalculated.
    // If the recalculated size would be out of range, the fixed ratio is turned off instead.
    const reconcileRatio = () => {
        if (!values.fixedRatio) {
            return;
        }
        const unit = values.unit;
        const ratio = values.ratioWidth / values.ratioHeight;
        const step = unit === "mm" ? 0.01 : 1; // the smallest size difference the form can hold
        const tolerance = (step / 2) * (1 + ratio) + 1e-9;

        if (Math.abs(values.cellWidth - values.cellHeight * ratio) <= tolerance) {
            return; // already matches, to within rounding
        }

        const keepHeight = values.ratioKeep === "height";
        const changedKey = keepHeight ? "cellWidth" : "cellHeight";
        const keptName = keepHeight ? "height" : "width";
        const changedName = keepHeight ? "width" : "height";
        const newValue = keepHeight
            ? roundSize(values.cellHeight * ratio, unit)
            : roundSize(values.cellWidth / ratio, unit);

        const sizeText = `${values.cellWidth} × ${values.cellHeight} ${unit}`;
        const ratioText = `${values.ratioWidth} : ${values.ratioHeight}`;

        if (SETTING_RULES[changedKey].valid(newValue, unit)) {
            warnings.push(
                `Cell shape: the cell size in the file (${sizeText}) does not match its fixed ratio ` +
                `(${ratioText}); kept the ${keptName} and set the ${changedName} to ${newValue} ${unit}.`
            );
            values[changedKey] = newValue;
        } else {
            warnings.push(
                `Cell shape: the cell size in the file (${sizeText}) does not match its fixed ratio ` +
                `(${ratioText}), and the matching ${changedName} would be out of range; ` +
                `turned the fixed ratio off and kept the cell size.`
            );
            values.fixedRatio = false;
        }
    };
    reconcileRatio();

    // Combined check 3: valid numbers can still make a canvas that's too big.
    const toPixels = (value) => {
        const pixels = values.unit === "mm" ? mmToPixels(value, values.dpi) : value;
        return value > 0 && pixels < 1 ? 1 : pixels; // same rule as the form
    };
    const size = getCanvasSize({
        columns: values.columns,
        rows: values.rows,
        cellWidth: toPixels(values.cellWidth),
        cellHeight: toPixels(values.cellHeight),
        borderWidth: toPixels(values.borderWidth),
    });

    if (isCanvasTooLarge(size)) {
        for (const key of ["columns", "rows", "cellWidth", "cellHeight", "borderWidth"]) {
            values[key] = getDefaultFor(key, values.unit, values.dpi);
        }
        warnings.push(
            `Grid size: those columns, rows, cell size, and border width would make an output ` +
            `image of ${size.width} × ${size.height} pixels, which is too large for browsers ` +
            `to draw reliably; used the defaults for all five.`
        );
        reconcileRatio(); // the default size may no longer match the ratio
    }

    // Combined check 4: the margins must leave room on the paper.
    const paperMm = getPaperMm(values.paper, values.orientation, values.customSide1, values.customSide2);
    if (paperMm && 2 * values.margin >= Math.min(paperMm.width, paperMm.height)) {
        warnings.push(
            `Margin: ${values.margin} mm leaves no room to print on this paper; ` +
            `used the default, ${DEFAULT_SETTINGS.margin} mm.`
        );
        values.margin = DEFAULT_SETTINGS.margin;
    }

    // Anything in the file that this version doesn't know about.
    const unknown = Object.keys(rawSettings).filter((key) => !Object.hasOwn(DEFAULT_SETTINGS, key));
    if (unknown.length > 0) {
        const shown = unknown.slice(0, 5).join(", ");
        const more = unknown.length > 5 ? `, and ${unknown.length - 5} more` : "";
        warnings.push(`Ignored ${unknown.length} setting${unknown.length === 1 ? "" : "s"} this version doesn't use: ${shown}${more}.`);
    }

    return { values, warnings };
}

function setRadio(name, value) {
    document.querySelector(`input[name="${name}"][value="${value}"]`).checked = true;
}

// Puts a complete set of valid values into the form, then re-reads the form.
function applySettingsToForm(v) {
    setRadio("unit", v.unit);
    // Tell onSettingsChange the unit change is already handled. Otherwise it would
    // convert the numbers in the fields, overwriting the values set below.
    currentUnit = v.unit;

    numberFields.dpi.input.value = String(v.dpi);
    numberFields.columns.input.value = String(v.columns);
    numberFields.rows.input.value = String(v.rows);

    sizeFields.cellWidth.input.value = String(v.cellWidth);
    sizeFields.cellHeight.input.value = String(v.cellHeight);
    sizeFields.borderWidth.input.value = String(v.borderWidth);

    // The ratio. With it off, the boxes show the cell's shape (and the saved pair is unused).
    fixedRatioInput.checked = v.fixedRatio;
    setRadio("ratioMode", v.ratioMode);
    setRadio("ratioKeep", v.ratioKeep);
    ratioPair = { width: v.ratioWidth, height: v.ratioHeight };
    showRatio(ratioPair);
    if (!v.fixedRatio) {
        showCurrentShape();
    }

    setRadio("fitMode", v.fitMode);
    document.getElementById("border-color").value = v.borderColor;
    document.getElementById("background-color").value = v.backgroundColor;
    document.getElementById("border-empty").checked = v.borderEmptyCells;
    setRadio("borderTarget", v.borderTarget);

    document.getElementById("paper-size").value = v.paper;
    paperFields.customSide1.input.value = String(v.customSide1);
    paperFields.customSide2.input.value = String(v.customSide2);
    setRadio("orientation", v.orientation);
    paperFields.margin.input.value = String(v.margin);

    onSettingsChange(); // validates, updates limits, summary, and messages
}

// Shows a message plus an optional list of warnings under the preset buttons.
function showPresetResult(kind, message, warnings = []) {
    presetMessage.className = kind; // "", "warn", or "error"
    presetMessage.textContent = message;

    presetWarnings.textContent = "";
    for (const warning of warnings) {
        const item = document.createElement("li");
        item.textContent = warning;
        presetWarnings.append(item);
    }
}

async function loadSettingsFile(file) {
    if (file.size > MAX_SETTINGS_FILE_BYTES) {
        showPresetResult("error", `${file.name} is too large to be a settings file. Nothing was loaded.`);
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch (error) {
        showPresetResult("error", `${file.name} is not valid JSON, so nothing was loaded.`);
        return;
    }

    if (!isPlainObject(parsed) || parsed.format !== SETTINGS_FILE_FORMAT) {
        showPresetResult("error", `${file.name} is not a settings file saved by this program. Nothing was loaded.`);
        return;
    }
    if (!isPlainObject(parsed.settings)) {
        showPresetResult("error", `${file.name} has no settings section. Nothing was loaded.`);
        return;
    }

    const { values, warnings } = checkLoadedSettings(parsed.settings);

    // Version notes come first, since they may explain other warnings.
    if (typeof parsed.version !== "number") {
        warnings.unshift("The file has no version number.");
    } else if (parsed.version > SETTINGS_FILE_VERSION) {
        warnings.unshift(
            `The file was saved by a newer version of this program (file version ${parsed.version}, ` +
            `this program understands ${SETTINGS_FILE_VERSION}); some settings may not be understood.`
        );
    }

    applySettingsToForm(values);

    // Restore the preset name, or fall back to the filename without ".json".
    presetNameInput.value = typeof parsed.name === "string" && parsed.name !== ""
        ? parsed.name.slice(0, 80)
        : file.name.replace(/\.json$/i, "");

    // Safety net: the form should accept everything we just gave it.
    if (!settingsValid) {
        warnings.push("The form still rejected some loaded values. Check the red fields in the settings.");
    }

    if (warnings.length === 0) {
        showPresetResult("", `Loaded ${file.name}. All settings were valid.`);
    } else {
        showPresetResult(
            "warn",
            `Loaded ${file.name} with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}. ` +
            `Check the list below, then save the preset again to keep the corrections:`,
            warnings
        );
    }
}

document.getElementById("load-settings-button").addEventListener("click", () => {
    loadSettingsInput.click();
});

loadSettingsInput.addEventListener("change", () => {
    const file = loadSettingsInput.files[0];
    loadSettingsInput.value = ""; // so choosing the same file again still triggers "change"
    if (file) {
        loadSettingsFile(file);
    }
});

// --- Drawing ---

// Browsers limit canvas size, and the limits vary. These are conservative
// values that should work in all modern browsers.
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 100000000;

// True when an output image of this size would be too big for browsers to draw reliably.
function isCanvasTooLarge(size) {
    return size.width > MAX_CANVAS_SIDE ||
        size.height > MAX_CANVAS_SIDE ||
        size.width * size.height > MAX_CANVAS_AREA;
}

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

// --- Image preview (lightbox) ---

const lightbox = document.getElementById("lightbox");
const lightboxViewport = document.getElementById("lightbox-viewport");
const lightboxFrame = document.getElementById("lightbox-frame");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxTitle = document.getElementById("lightbox-title");
const lightboxDetails = document.getElementById("lightbox-details");
const lightboxPrev = document.getElementById("lightbox-prev");
const lightboxNext = document.getElementById("lightbox-next");

let lightboxIndex = 0; // which entry of `images` is showing

// Sizes the picture to fit the viewing area. The frame gets the ROTATED size, since
// that is the space the turned picture takes up. The picture inside keeps its own
// (unrotated) size and is centered and turned within the frame.
function layoutLightboxImage() {
    const image = images[lightboxIndex];
    const availableWidth = lightboxViewport.clientWidth;
    const availableHeight = lightboxViewport.clientHeight;
    if (!image || availableWidth === 0 || availableHeight === 0) {
        return;
    }

    const rotated = getRotatedSize(image);
    // Fit inside the area, but never enlarge past the real size (the "1").
    const scale = Math.min(availableWidth / rotated.width, availableHeight / rotated.height, 1);

    lightboxFrame.style.width = `${Math.round(rotated.width * scale)}px`;
    lightboxFrame.style.height = `${Math.round(rotated.height * scale)}px`;

    lightboxImage.style.width = `${Math.round(image.width * scale)}px`;
    lightboxImage.style.height = `${Math.round(image.height * scale)}px`;
    lightboxImage.style.transform = `translate(-50%, -50%) rotate(${image.rotation}deg)`;
}

// Shows the image at `index`. Going past either end wraps around.
function showLightboxImage(index) {
    if (images.length === 0) {
        lightbox.close();
        return;
    }

    lightboxIndex = (index + images.length) % images.length;
    const image = images[lightboxIndex];

    const rotationText = image.rotation === 0 ? "not rotated" : `rotated ${image.rotation}° clockwise`;
    const copiesText = image.copies === 0
        ? "skipped (0 copies)"
        : `${image.copies} ${image.copies === 1 ? "copy" : "copies"}`;

    lightboxImage.src = image.url;
    lightboxImage.alt = image.file.name;
    lightboxTitle.textContent = image.file.name;
    lightboxDetails.textContent =
        `Image ${lightboxIndex + 1} of ${images.length} · ${image.width} × ${image.height} px · ` +
        `${formatBytes(image.file.size)} · ${rotationText} · ${copiesText}`;

    lightboxPrev.disabled = images.length < 2;
    lightboxNext.disabled = images.length < 2;

    layoutLightboxImage();
}

function openLightbox(index) {
    lightbox.showModal();      // first, so the viewing area has a size to measure
    showLightboxImage(index);
}

document.getElementById("lightbox-close").addEventListener("click", () => lightbox.close());
lightboxPrev.addEventListener("click", () => showLightboxImage(lightboxIndex - 1));
lightboxNext.addEventListener("click", () => showLightboxImage(lightboxIndex + 1));

// A click on the dimmed backdrop or on the empty space around the picture closes it.
// (Clicks outside a dialog's box are reported with the dialog itself as the target.)
lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox || event.target === lightboxViewport) {
        lightbox.close();
    }
});

// Esc closes the dialog by itself. The arrow keys move between images.
lightbox.addEventListener("keydown", (event) => {
    if (images.length < 2) {
        return;
    }
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        showLightboxImage(lightboxIndex - 1);
    } else if (event.key === "ArrowRight") {
        event.preventDefault();
        showLightboxImage(lightboxIndex + 1);
    }
});

// The viewing area changes size with the window, so fit the picture again.
window.addEventListener("resize", () => {
    if (lightbox.open) {
        layoutLightboxImage();
    }
});

// Let go of the picture when closed; the image's blob URL may be revoked later.
lightbox.addEventListener("close", () => lightboxImage.removeAttribute("src"));

// --- Start up ---
updateStatus();
applySettingsToForm(DEFAULT_SETTINGS); // fills the form from the defaults, then reads it