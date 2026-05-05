var SystematicReviewerNativeEditor = {
	_nativeCurrentBlocks(controller) {
		if (controller.mode == "native" && controller.els.nativeEditor.querySelector(".sr-native-root")) {
			return this._collectNativeBlocks(controller);
		}
		return (controller.nativeBlocks || []).slice();
	},

	_activeNativeBlockIndex(controller) {
		return -1;
	},

	_activePageBody(controller) {
		return controller.nativeActiveEditable?.closest?.(".sr-page-editor-body") || controller.els.nativeEditor.querySelector(".sr-page-editor-body") || null;
	},

	_activePageSheet(controller) {
		return this._activePageBody(controller)?.closest?.(".sr-page-sheet") || controller.els.nativeEditor.querySelector(".sr-page-sheet") || null;
	},

	_currentInsertionState(controller) {
		let liveState = this._captureEditorSelectionState(
			controller,
			controller.doc.activeElement || controller.nativeActiveEditable || controller.els.nativeEditor.querySelector(".sr-page-editor-body")
		);
		if (liveState?.range || liveState?.citationNode || liveState?.textareaStart !== null) {
			return liveState;
		}
		return controller.lastSelectionState || liveState;
	},

	_focusEditableEnd(editable) {
		if (!editable) {
			return;
		}
		editable.focus();
		try {
			let selection = editable.ownerDocument.defaultView.getSelection();
			let range = editable.ownerDocument.createRange();
			range.selectNodeContents(editable);
			range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
		}
		catch (_err) {}
	},

	_focusEditableStart(editable) {
		if (!editable) {
			return;
		}
		editable.focus();
		try {
			let selection = editable.ownerDocument.defaultView.getSelection();
			let range = editable.ownerDocument.createRange();
			range.selectNodeContents(editable);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
		}
		catch (_err) {}
	},

	_setEditableMarkdown(controller, editable, markdownText) {
		if (!editable) {
			return;
		}
		if (editable.tagName?.toLowerCase() == "textarea") {
			editable.value = String(markdownText || "");
			return;
		}
		let html = this._contentEditableHTMLFromMarkdown(controller, markdownText || "");
		editable.innerHTML = html || "<br />";
	},

	_markNativeEditorDirty(controller) {
		controller.nativeDirty = true;
		controller.documentDirty = true;
		controller.previewStale = true;
	},

	_selectionRangeWithinEditable(controller, editable) {
		if (!editable || editable.tagName?.toLowerCase() == "textarea") {
			return null;
		}
		try {
			let selection = controller.doc.defaultView.getSelection();
			if (!selection || !selection.rangeCount) {
				return null;
			}
			let range = selection.getRangeAt(0);
			let startContainer = range.startContainer?.nodeType == 3 ? range.startContainer.parentNode : range.startContainer;
			let endContainer = range.endContainer?.nodeType == 3 ? range.endContainer.parentNode : range.endContainer;
			if (editable.contains(startContainer) && editable.contains(endContainer)) {
				return range.cloneRange();
			}
		}
		catch (_err) {}
		return null;
	},

	_splitEditableAtSelection(controller, editable) {
		let full = String(this._inlineMarkdownFromNode(editable) || "").replace(/\u00a0/g, " ");
		let range = this._selectionRangeWithinEditable(controller, editable);
		if (!range) {
			return { before: full, after: "", full, collapsed: true };
		}
		let beforeRange = editable.ownerDocument.createRange();
		beforeRange.selectNodeContents(editable);
		beforeRange.setEnd(range.startContainer, range.startOffset);
		let afterRange = editable.ownerDocument.createRange();
		afterRange.selectNodeContents(editable);
		afterRange.setStart(range.endContainer, range.endOffset);
		let beforeHolder = controller.doc.createElement("div");
		let afterHolder = controller.doc.createElement("div");
		beforeHolder.appendChild(beforeRange.cloneContents());
		afterHolder.appendChild(afterRange.cloneContents());
		return {
			before: String(this._inlineMarkdownFromNode(beforeHolder) || "").replace(/\u00a0/g, " "),
			after: String(this._inlineMarkdownFromNode(afterHolder) || "").replace(/\u00a0/g, " "),
			full,
			collapsed: range.collapsed,
		};
	},

	_createParagraphBlock(controller, markdownText = "") {
		let block = this._createEmptyParagraphBlock(controller);
		this._setEditableMarkdown(controller, block.querySelector(".sr-block-editable"), markdownText);
		return block;
	},

	_createParagraphBlockWithHTML(controller, html = "") {
		let block = this._createEmptyParagraphBlock(controller);
		let editable = block.querySelector(".sr-block-editable");
		editable.innerHTML = html || "<br />";
		return block;
	},

	_createListItemRow(controller, markdownText = "", ordered = false, index = 0, level = 0) {
		let row = this._html(controller.doc, "div", { className: "sr-native-list-item" });
		this._setListItemLevel(row, level);
		row.append(
			this._html(controller.doc, "div", {
				className: "sr-native-list-marker",
				attrs: { contenteditable: "false" },
				text: ordered ? `${index + 1}.` : "•",
			}),
			this._editableNode(controller, markdownText)
		);
		return row;
	},

	_listItemLevel(row) {
		return Math.max(0, Number(row?.getAttribute?.("data-level") || row?.dataset?.level || 0) || 0);
	},

	_setListItemLevel(row, level) {
		if (!row) {
			return;
		}
		let normalized = Math.max(0, Math.min(8, Number(level || 0) || 0));
		row.setAttribute("data-level", String(normalized));
		row.style.setProperty("--sr-list-level", String(normalized));
	},

	_renumberListBlock(listBlock) {
		if (!listBlock) {
			return;
		}
		let ordered = listBlock.getAttribute("data-list-kind") == "ol";
		let rows = Array.from(listBlock.querySelectorAll(".sr-native-list-item"));
		let items = SystematicReviewerNativeMarkdown.normalizeListItems(
			rows.map((row) => ({
				text: this._inlineMarkdownFromNode(row.querySelector(".sr-block-editable") || row).trim(),
				level: this._listItemLevel(row),
			}))
		);
		let orderedLabels = ordered ? SystematicReviewerNativeMarkdown.orderedListMarkerLabels(items) : [];
		rows.forEach((row, index) => {
			this._setListItemLevel(row, items[index]?.level || 0);
			let marker = row.querySelector(".sr-native-list-marker");
			if (marker) {
				marker.textContent = ordered ? (orderedLabels[index] || `${index + 1}.`) : "•";
			}
		});
	},

	_tableCellDescriptor(cell) {
		if (!cell) {
			return null;
		}
		return {
			section: cell.getAttribute("data-sr-table-section") || (cell.tagName == "TH" ? "header" : "body"),
			rowIndex: Number(cell.getAttribute("data-row-index") || 0),
			columnIndex: Number(cell.getAttribute("data-column-index") || 0),
			colspan: Math.max(1, Number(cell.getAttribute("data-colspan") || cell.colSpan || 1)),
		};
	},

	_normalizeTableSelectionCells(cells) {
		let seen = new Set();
		return (cells || [])
			.filter(Boolean)
			.map((cell) => ({
				section: cell.section || "body",
				rowIndex: Number(cell.rowIndex || 0),
				columnIndex: Number(cell.columnIndex || 0),
				colspan: Math.max(1, Number(cell.colspan || 1)),
			}))
			.filter((cell) => {
				let key = `${cell.section}:${cell.rowIndex}:${cell.columnIndex}`;
				if (seen.has(key)) {
					return false;
				}
				seen.add(key);
				return true;
			})
			.sort((left, right) =>
				left.section.localeCompare(right.section)
				|| left.rowIndex - right.rowIndex
				|| left.columnIndex - right.columnIndex
			);
	},

	_tableCellElementFromDescriptor(table, descriptor) {
		if (!table || !descriptor) {
			return null;
		}
		let exact = table.querySelector(
			`${descriptor.section == "header" ? "th" : "td"}[data-sr-table-section="${descriptor.section}"][data-row-index="${descriptor.rowIndex}"][data-column-index="${descriptor.columnIndex}"]`
		);
		if (exact) {
			return exact;
		}
		return Array.from(table.querySelectorAll(`${descriptor.section == "header" ? "th" : "td"}[data-sr-table-section="${descriptor.section}"][data-row-index="${descriptor.rowIndex}"]`))
			.find((cell) => {
				let start = Number(cell.getAttribute("data-column-index") || 0);
				let span = Math.max(1, Number(cell.getAttribute("data-colspan") || cell.colSpan || 1));
				return descriptor.columnIndex >= start && descriptor.columnIndex < start + span;
			}) || null;
	},

	_tableCellDescriptorEquals(left, right) {
		return !!left && !!right
			&& left.section == right.section
			&& Number(left.rowIndex) == Number(right.rowIndex)
			&& Number(left.columnIndex) == Number(right.columnIndex);
	},

	_tableSelectionContains(cells, descriptor) {
		return (cells || []).some((cell) => this._tableCellDescriptorEquals(cell, descriptor));
	},

	_clearTableSelection(controller) {
		controller.tableSelection = null;
		for (let cell of Array.from(controller.els.nativeEditor.querySelectorAll(".sr-table-cell-selected"))) {
			cell.classList.remove("sr-table-cell-selected");
		}
	},

	_applyTableSelectionClasses(controller) {
		for (let cell of Array.from(controller.els.nativeEditor.querySelectorAll(".sr-table-cell-selected"))) {
			cell.classList.remove("sr-table-cell-selected");
		}
		let selection = controller.tableSelection;
		if (!selection?.table) {
			return;
		}
		for (let descriptor of selection.cells || []) {
			let cell = this._tableCellElementFromDescriptor(selection.table, descriptor);
			cell?.classList?.add("sr-table-cell-selected");
		}
	},

	_setTableSelection(controller, table, cells, anchor = null) {
		if (!table || !(cells || []).length) {
			this._clearTableSelection(controller);
			return;
		}
		let normalized = this._normalizeTableSelectionCells(cells);
		controller.tableSelection = {
			table,
			tableBlock: table.closest(".sr-block-table") || null,
			cells: normalized,
			anchor: anchor || normalized[0] || null,
		};
		this._applyTableSelectionClasses(controller);
	},

	_tableCellsInRange(table, anchor, target) {
		if (!table || !anchor || !target) {
			return [];
		}
		if (anchor.section != target.section || anchor.rowIndex != target.rowIndex) {
			return [target];
		}
		let start = Math.min(anchor.columnIndex, target.columnIndex);
		let end = Math.max(anchor.columnIndex + anchor.colspan - 1, target.columnIndex + target.colspan - 1);
		return Array.from(table.querySelectorAll(`${anchor.section == "header" ? "th" : "td"}[data-sr-table-section="${anchor.section}"][data-row-index="${anchor.rowIndex}"]`))
			.map((cell) => this._tableCellDescriptor(cell))
			.filter((cell) => cell && cell.columnIndex <= end && (cell.columnIndex + cell.colspan - 1) >= start);
	},

	_updateTableSelectionFromInteraction(controller, cell, event) {
		let table = cell?.closest?.("table");
		let descriptor = this._tableCellDescriptor(cell);
		if (!table || !descriptor) {
			this._clearTableSelection(controller);
			return;
		}
		let current = controller.tableSelection;
		let sameTable = current?.table == table;
		if (event?.shiftKey && sameTable && current?.anchor) {
			this._setTableSelection(controller, table, this._tableCellsInRange(table, current.anchor, descriptor), current.anchor);
			return;
		}
		if ((event?.metaKey || event?.ctrlKey) && sameTable) {
			let nextCells = current.cells.slice();
			if (this._tableSelectionContains(nextCells, descriptor) && nextCells.length > 1) {
				nextCells = nextCells.filter((candidate) => !this._tableCellDescriptorEquals(candidate, descriptor));
			}
			else if (!this._tableSelectionContains(nextCells, descriptor)) {
				nextCells.push(descriptor);
			}
			this._setTableSelection(controller, table, nextCells, current.anchor || descriptor);
			return;
		}
		this._setTableSelection(controller, table, [descriptor], descriptor);
	},

	_selectedTableCellsForTarget(controller, cell) {
		let table = cell?.closest?.("table");
		let descriptor = this._tableCellDescriptor(cell);
		let current = controller.tableSelection;
		if (table && descriptor && current?.table == table && this._tableSelectionContains(current.cells, descriptor)) {
			return current.cells.slice();
		}
		return descriptor ? [descriptor] : [];
	},

	_focusTableCellDescriptor(controller, table, descriptor, { atEnd = false } = {}) {
		let cell = this._tableCellElementFromDescriptor(table, descriptor);
		let editable = cell?.querySelector?.(".sr-native-table-cell");
		if (!editable) {
			return null;
		}
		controller.nativeActiveEditable = editable;
		if (atEnd) {
			this._focusEditableEnd(editable);
		}
		else {
			this._focusEditableStart(editable);
		}
		return editable;
	},

	_replaceNativeTableBlock(controller, oldBlock, block, { focusCell = null, selectionCells = null } = {}) {
		let replacement = this._renderNativeTableBlock(
			controller,
			SystematicReviewerNativeMarkdown.normalizeTableBlock(block),
			oldBlock?.getAttribute?.("data-index") || Date.now()
		);
		oldBlock.replaceWith(replacement);
		let table = replacement.querySelector("table");
		if (selectionCells?.length) {
			this._setTableSelection(controller, table, selectionCells, focusCell || selectionCells[0]);
		}
		else {
			this._clearTableSelection(controller);
		}
		if (focusCell) {
			this._focusTableCellDescriptor(controller, table, focusCell, { atEnd: true });
		}
		this._markNativeEditorDirty(controller);
		return replacement;
	},

	_insertColumnIntoTableBlock(block, boundaryIndex) {
		return SystematicReviewerNativeMarkdown.insertColumnIntoTableBlock(block, boundaryIndex);
	},

	_insertRowIntoTableBlock(block, rowIndex) {
		return SystematicReviewerNativeMarkdown.insertRowIntoTableBlock(block, rowIndex);
	},

	_applyAlignmentToTableBlock(block, cells, align) {
		return SystematicReviewerNativeMarkdown.applyAlignmentToTableBlock(block, cells, align);
	},

	_canMergeTableCells(cells) {
		return SystematicReviewerNativeMarkdown.canMergeTableCells(cells);
	},

	_mergeTableCellsInBlock(block, cells) {
		return SystematicReviewerNativeMarkdown.mergeTableCellsInBlock(block, cells);
	},

	_lastEditableInNode(node) {
		if (!node?.querySelectorAll) {
			return null;
		}
		let editables = Array.from(node.querySelectorAll("[data-sr-editable='true']"));
		return editables[editables.length - 1] || null;
	},

	_firstEditableInNode(node) {
		return node?.querySelector?.("[data-sr-editable='true']") || null;
	},

	_focusNearestEditableFromBlock(controller, block) {
		let body = block?.closest?.(".sr-page-editor-body");
		let previous = block?.previousElementSibling || null;
		while (previous) {
			let editable = this._lastEditableInNode(previous);
			if (editable) {
				controller.nativeActiveEditable = editable;
				this._focusEditableEnd(editable);
				return editable;
			}
			previous = previous.previousElementSibling;
		}
		let next = block?.nextElementSibling || null;
		while (next) {
			let editable = this._firstEditableInNode(next);
			if (editable) {
				controller.nativeActiveEditable = editable;
				this._focusEditableStart(editable);
				return editable;
			}
			next = next.nextElementSibling;
		}
		let paragraph = this._ensureTrailingEditableParagraph(body);
		controller.nativeActiveEditable = paragraph || controller.nativeActiveEditable;
		this._focusEditableEnd(paragraph);
		return paragraph;
	},

	_focusNextTableCell(controller, editable) {
		let cell = editable?.closest?.("td, th");
		let row = cell?.parentElement;
		let table = row?.closest?.("table");
		if (!cell || !row || !table) {
			return;
		}
		let descriptor = this._tableCellDescriptor(cell);
		if (!descriptor) {
			return;
		}
		let block = table.closest(".sr-block-table");
		let tableBlock = this._nativeTableBlockFromElement(block);
		let nextDescriptor = null;
		if (descriptor.section == "header") {
			nextDescriptor = { section: "body", rowIndex: 0, columnIndex: descriptor.columnIndex, colspan: 1 };
		}
		else if (descriptor.rowIndex + 1 < tableBlock.rows.length) {
			nextDescriptor = { section: "body", rowIndex: descriptor.rowIndex + 1, columnIndex: descriptor.columnIndex, colspan: 1 };
		}
		else {
			let nextBlock = this._insertRowIntoTableBlock(tableBlock, tableBlock.rows.length);
			block = this._replaceNativeTableBlock(controller, block, nextBlock, {
				focusCell: { section: "body", rowIndex: nextBlock.rows.length - 1, columnIndex: descriptor.columnIndex, colspan: 1 },
				selectionCells: [{ section: "body", rowIndex: nextBlock.rows.length - 1, columnIndex: descriptor.columnIndex, colspan: 1 }],
			});
			return block;
		}
		this._setTableSelection(controller, table, [nextDescriptor], nextDescriptor);
		this._focusTableCellDescriptor(controller, table, nextDescriptor);
	},

	_insertPageSheetAfter(controller, layout = "portrait") {
		let currentSheet = this._activePageSheet(controller);
		if (!currentSheet) {
			return null;
		}
		let sheet = this._html(controller.doc, "div", {
			className: "sr-page-sheet",
			attrs: {
				"data-sr-layout": layout,
			},
		});
		let body = this._html(controller.doc, "div", {
			className: "sr-page-sheet-body sr-page-editor-body",
			attrs: {
				"data-sr-page-body": "true",
				contenteditable: "true",
				spellcheck: "true",
			},
		});
		body.appendChild(this._createEmptyParagraphBlock(controller));
		sheet.appendChild(body);
		currentSheet.after(sheet);
		let paragraph = body.querySelector(".sr-block-editable");
		controller.nativeActiveEditable = paragraph;
		this._focusEditableEnd(paragraph);
		return body;
	},

	_activeEditableNode(controller) {
		return controller.nativeActiveEditable?.matches?.("[data-sr-editable='true']")
			? controller.nativeActiveEditable
			: controller.els.nativeEditor.querySelector("[data-sr-editable='true']")
				|| this._ensureTrailingEditableParagraph(this._activePageBody(controller));
	},

	_nativeExecCommand(controller, command) {
		if (controller.mode != "native") {
			this._setWorkspaceMode(controller, "native");
		}
		let state = this._currentInsertionState(controller);
		this._restoreEditorSelectionState(controller, state);
		let editable = this._activeEditableNode(controller);
		if (editable?.focus) {
			editable.focus();
		}
		try {
			controller.doc.execCommand(command, false, null);
			this._markNativeEditorDirty(controller);
		}
		catch (_err) {}
	},

	_applyHeadingToActiveBlock(controller, level) {
		if (controller.mode != "native") {
			this._setWorkspaceMode(controller, "native");
		}
		let state = this._currentInsertionState(controller);
		this._restoreEditorSelectionState(controller, state);
		let editable = this._activeEditableNode(controller);
		let block = editable?.closest?.(".sr-native-block");
		if (!editable || !block || block.getAttribute("data-block-type") == "table" || block.getAttribute("data-block-type") == "image") {
			return;
		}
		block.setAttribute("data-block-type", "heading");
		block.className = "sr-native-block sr-block-heading";
		block.setAttribute("data-level", String(Math.max(1, Math.min(5, level || 1))));
		this._markNativeEditorDirty(controller);
	},

	_insertListBlock(controller, ordered) {
		if (controller.mode != "native") {
			this._setWorkspaceMode(controller, "native");
		}
		let state = this._currentInsertionState(controller);
		this._restoreEditorSelectionState(controller, state);
		let body = state?.editable?.closest?.(".sr-page-editor-body") || this._activePageBody(controller);
		let currentBlock = state?.editable?.closest?.(".sr-native-block");
		if (!body) {
			return;
		}
		let currentType = currentBlock?.getAttribute?.("data-block-type") || "";
		if (currentBlock && ["paragraph", "heading"].includes(currentType)) {
			let currentText = this._inlineMarkdownFromNode(state?.editable || currentBlock.querySelector(".sr-block-editable")).trim();
			let listNode = this._renderNativeBlock(controller, {
				type: "list",
				ordered: !!ordered,
				items: [{ text: currentText, level: 0 }],
			}, Date.now());
			let paragraphNode = this._createParagraphBlock(controller, "");
			currentBlock.replaceWith(listNode);
			listNode.after(paragraphNode);
			let firstItem = listNode.querySelector(".sr-block-editable");
			controller.nativeActiveEditable = firstItem || paragraphNode.querySelector(".sr-block-editable");
			this._focusEditableEnd(controller.nativeActiveEditable);
			this._markNativeEditorDirty(controller);
			return;
		}
		let listNode = this._renderNativeBlock(controller, {
			type: "list",
			ordered: !!ordered,
			items: [{ text: "", level: 0 }],
		}, Date.now());
		let paragraphNode = this._createParagraphBlock(controller, "");
		if (currentBlock && currentBlock.parentNode == body) {
			currentBlock.after(listNode, paragraphNode);
		}
		else {
			body.append(listNode, paragraphNode);
		}
		let firstItem = listNode.querySelector(".sr-block-editable");
		controller.nativeActiveEditable = firstItem || paragraphNode.querySelector(".sr-block-editable");
		this._focusEditableEnd(controller.nativeActiveEditable);
		this._markNativeEditorDirty(controller);
	},

	_selectionBoundaryEditableFromRange(range, edge = "start") {
		if (!range) {
			return null;
		}
		let node = edge == "end" ? range.endContainer : range.startContainer;
		return node?.nodeType == 3
			? node.parentNode?.closest?.("[data-sr-editable='true']") || node.parentNode
			: node?.closest?.("[data-sr-editable='true']") || null;
	},

	_selectionSpansMultipleEditables(state) {
		let range = state?.range || null;
		if (!range || range.collapsed) {
			return false;
		}
		let startEditable = this._selectionBoundaryEditableFromRange(range, "start");
		let endEditable = this._selectionBoundaryEditableFromRange(range, "end");
		return !!(startEditable && endEditable && startEditable !== endEditable);
	},

	_normalizeNativeEditorAfterMutation(controller, preferredEditable = null) {
		let blocks = [];
		try {
			blocks = this._collectNativeBlocks(controller);
		}
		catch (_err) {
			blocks = [];
		}
		controller.nativeBlocks = blocks;
		let nativeEditor = controller?.els?.nativeEditor;
		let preferredBlock = preferredEditable?.closest?.(".sr-native-block") || null;
		let blockIndex = preferredBlock && nativeEditor
			? Array.from(nativeEditor.querySelectorAll(".sr-native-block")).indexOf(preferredBlock)
			: -1;
		this._renderNativeEditor(controller);
		let blockNodes = Array.from(controller.els.nativeEditor.querySelectorAll(".sr-native-block"));
		let targetBlock = blockIndex >= 0
			? blockNodes[Math.min(Math.max(blockIndex, 0), Math.max(blockNodes.length - 1, 0))]
			: null;
		let nextEditable =
			targetBlock?.querySelector?.("[data-sr-editable='true']")
			|| controller.els.nativeEditor.querySelector("[data-sr-editable='true']");
		controller.nativeActiveEditable = nextEditable || controller.nativeActiveEditable;
		if (nextEditable) {
			this._focusEditableStart(nextEditable);
		}
	},

	_handleNativeSelectionDeletionKey(controller, event, state) {
		let isMac = /mac/i.test(String(controller.doc.defaultView?.navigator?.platform || ""));
		let backwardDelete = event.key == "Backspace" || (isMac && event.key == "Delete");
		let forwardDelete = event.key == "Delete" && !backwardDelete;
		if ((!backwardDelete && !forwardDelete) || event.metaKey || event.ctrlKey || event.altKey) {
			return false;
		}
		if (!this._editorHasSelection(state)) {
			return false;
		}
		event.preventDefault();
		this._deleteEditorSelection(controller, state);
		this._markNativeEditorDirty(controller);
		controller.lastSelectionState = this._captureEditorSelectionState(controller, controller.nativeActiveEditable || state?.editable || controller.els.nativeEditor);
		return true;
	},

	_selectedListRowsFromState(controller, listBlock, state) {
		if (!listBlock || !state?.range) {
			return [];
		}
		let startEditable = this._selectionBoundaryEditableFromRange(state.range, "start");
		let endEditable = this._selectionBoundaryEditableFromRange(state.range, "end");
		let startRow = startEditable?.closest?.(".sr-native-list-item") || null;
		let endRow = endEditable?.closest?.(".sr-native-list-item") || null;
		if (!startRow || !endRow || startRow.closest("[data-block-type='list']") !== listBlock || endRow.closest("[data-block-type='list']") !== listBlock) {
			return [];
		}
		let rows = Array.from(listBlock.querySelectorAll(".sr-native-list-item"));
		let startIndex = rows.indexOf(startRow);
		let endIndex = rows.indexOf(endRow);
		if (startIndex < 0 || endIndex < 0) {
			return [];
		}
		return rows.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
	},

	_handleNativeTabKey(controller, event, editable, state = null) {
		if (event.key != "Tab" || event.metaKey || event.ctrlKey || event.altKey || !editable || editable.tagName?.toLowerCase() == "textarea" || editable.classList?.contains("sr-native-table-cell")) {
			return false;
		}
		let listItem = editable.closest(".sr-native-list-item");
		let listBlock = editable.closest("[data-block-type='list']");
		if (!listItem || !listBlock) {
			return false;
		}
		event.preventDefault();
		let rows = this._selectedListRowsFromState(controller, listBlock, state);
		if (!rows.length) {
			rows = [listItem];
		}
		let allRows = Array.from(listBlock.querySelectorAll(".sr-native-list-item"));
		for (let row of rows) {
			let currentLevel = this._listItemLevel(row);
			let nextLevel = Math.max(0, currentLevel + (event.shiftKey ? -1 : 1));
			let rowIndex = allRows.indexOf(row);
			let previousRow = rowIndex > 0 ? allRows[rowIndex - 1] : null;
			let maxLevel = previousRow ? this._listItemLevel(previousRow) + 1 : 0;
			nextLevel = Math.min(nextLevel, maxLevel);
			this._setListItemLevel(row, nextLevel);
		}
		this._renumberListBlock(listBlock);
		controller.nativeActiveEditable = editable;
		controller.lastSelectionState = this._captureEditorSelectionState(controller, editable);
		this._markNativeEditorDirty(controller);
		return true;
	},

	_handleNativeEnterKey(controller, event, editable, pageBody) {
		if (event.key != "Enter" || event.metaKey || event.ctrlKey || event.altKey) {
			return false;
		}
		if (editable?.classList?.contains("sr-native-table-cell")) {
			event.preventDefault();
			this._focusNextTableCell(controller, editable);
			return true;
		}
		if (!editable || editable.tagName?.toLowerCase() == "textarea") {
			return false;
		}
		let listItem = editable.closest(".sr-native-list-item");
		if (listItem) {
			event.preventDefault();
			let split = this._splitEditableAtSelection(controller, editable);
			let listBlock = editable.closest("[data-block-type='list']");
			let ordered = listBlock?.getAttribute("data-list-kind") == "ol";
			if (!String(split.before || "").trim() && !String(split.after || "").trim()) {
				let paragraph = this._createParagraphBlock(controller, "");
				listBlock?.after?.(paragraph);
				listItem.remove();
				if (listBlock && !listBlock.querySelector(".sr-native-list-item")) {
					listBlock.remove();
				}
				else {
					this._renumberListBlock(listBlock);
				}
				let nextEditable = paragraph.querySelector(".sr-block-editable");
				controller.nativeActiveEditable = nextEditable || controller.nativeActiveEditable;
				this._focusEditableStart(nextEditable);
				this._markNativeEditorDirty(controller);
				return true;
			}
			this._setEditableMarkdown(controller, editable, split.before);
			let newItem = this._createListItemRow(controller, split.after, ordered, 0, this._listItemLevel(listItem));
			listItem.after(newItem);
			this._renumberListBlock(listBlock);
			let nextEditable = newItem.querySelector(".sr-block-editable");
			controller.nativeActiveEditable = nextEditable || controller.nativeActiveEditable;
			this._focusEditableStart(nextEditable);
			this._markNativeEditorDirty(controller);
			return true;
		}
		let block = editable.closest(".sr-native-block");
		let blockType = block?.getAttribute("data-block-type") || "";
		if (!block || !["paragraph", "heading"].includes(blockType)) {
			return false;
		}
		event.preventDefault();
		let split = this._splitEditableAtSelection(controller, editable);
		let newBlock = this._createParagraphBlock(controller, split.after);
		if (blockType == "heading" && split.collapsed && !split.before && split.after == split.full) {
			block.before(newBlock);
		}
		else {
			this._setEditableMarkdown(controller, editable, split.before);
			if (blockType == "heading" && !String(split.before || "").trim()) {
				block.setAttribute("data-block-type", "paragraph");
				block.className = "sr-native-block sr-block-paragraph";
				block.removeAttribute("data-level");
			}
			block.after(newBlock);
		}
		let nextEditable = newBlock.querySelector(".sr-block-editable");
		controller.nativeActiveEditable = nextEditable || controller.nativeActiveEditable;
		this._focusEditableStart(nextEditable);
		this._markNativeEditorDirty(controller);
		return true;
	},

	_handleNativeDeletionKey(controller, event, editable) {
		let isMac = /mac/i.test(String(controller.doc.defaultView?.navigator?.platform || ""));
		let backwardDelete = event.key == "Backspace" || (isMac && event.key == "Delete");
		let forwardDelete = event.key == "Delete" && !backwardDelete;
		if ((!backwardDelete && !forwardDelete) || event.metaKey || event.ctrlKey || event.altKey) {
			return false;
		}
		if (!editable || editable.tagName?.toLowerCase() == "textarea" || editable.classList?.contains("sr-native-table-cell")) {
			return false;
		}
		let range = this._selectionRangeWithinEditable(controller, editable);
		if (range && !range.collapsed) {
			return false;
		}
		let hasMeaningfulContent = String(this._inlineMarkdownFromNode(editable) || "").trim().length > 0;
		if (hasMeaningfulContent) {
			return false;
		}
		let listItem = editable.closest(".sr-native-list-item");
		if (listItem) {
			event.preventDefault();
			let listBlock = editable.closest("[data-block-type='list']");
			let body = listBlock?.closest?.(".sr-page-editor-body") || this._activePageBody(controller);
			listItem.remove();
			if (listBlock && !listBlock.querySelector(".sr-native-list-item")) {
				let paragraph = this._createParagraphBlock(controller, "");
				if (body) {
					listBlock.after(paragraph);
				}
				listBlock?.remove?.();
				let nextEditable = paragraph.querySelector(".sr-block-editable");
				controller.nativeActiveEditable = nextEditable || controller.nativeActiveEditable;
				this._focusEditableStart(nextEditable);
			}
			else {
				this._renumberListBlock(listBlock);
				this._focusNearestEditableFromBlock(controller, listBlock);
			}
			this._markNativeEditorDirty(controller);
			return true;
		}
		let block = editable.closest(".sr-native-block");
		let type = block?.getAttribute("data-block-type") || "";
		if (!block || !["paragraph", "heading"].includes(type)) {
			return false;
		}
		event.preventDefault();
		let body = block.closest(".sr-page-editor-body");
		let nextFocus = this._focusNearestEditableFromBlock(controller, block);
		block.remove();
		if (!body?.querySelector?.("[data-sr-editable='true']")) {
			let paragraph = this._createParagraphBlock(controller, "");
			body?.appendChild(paragraph);
			nextFocus = paragraph.querySelector(".sr-block-editable");
			this._focusEditableStart(nextFocus);
		}
		controller.nativeActiveEditable = nextFocus || controller.nativeActiveEditable;
		this._markNativeEditorDirty(controller);
		return true;
	},

	_insertTableBlock(controller) {
		if (controller.mode != "native") {
			this._setWorkspaceMode(controller, "native");
		}
		let state = this._currentInsertionState(controller);
		let win = controller.doc.defaultView;
		let rowCount = Number(win.prompt("How many data rows?", "3") || "3");
		let columnCount = Number(win.prompt("How many columns?", "3") || "3");
		rowCount = Number.isFinite(rowCount) && rowCount > 0 ? Math.min(20, Math.max(1, rowCount)) : 3;
		columnCount = Number.isFinite(columnCount) && columnCount > 0 ? Math.min(20, Math.max(1, columnCount)) : 3;
		let block = {
			type: "table",
			header: Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`),
			alignments: Array.from({ length: columnCount }, () => "left"),
			rows: Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ({ text: "", colspan: 1 }))),
			captionAbove: "",
			noteBelow: "",
		};
		let tableNode = this._renderNativeTableBlock(controller, block, Date.now());
		let paragraphNode = this._createEmptyParagraphBlock(controller);
		let body = (state?.editable?.closest?.(".sr-page-editor-body")) || this._activePageBody(controller);
		let currentBlock = state?.editable?.closest?.(".sr-native-block");
		if (!body) {
			return;
		}
		if (currentBlock && currentBlock.parentNode == body) {
			currentBlock.after(tableNode, paragraphNode);
		}
		else {
			body.append(tableNode, paragraphNode);
		}
		let firstCell = tableNode.querySelector(".sr-native-table-cell");
		controller.nativeActiveEditable = firstCell || paragraphNode.querySelector(".sr-block-editable");
		if (controller.nativeActiveEditable) {
			this._focusEditableEnd(controller.nativeActiveEditable);
		}
		this._markNativeEditorDirty(controller);
	},

	_insertPageBreakBlock(controller) {
		if (controller.mode != "native") {
			this._setWorkspaceMode(controller, "native");
		}
		let state = this._currentInsertionState(controller);
		this._restoreEditorSelectionState(controller, state);
		let currentBlock = state?.editable?.closest?.(".sr-native-block") || null;
		let currentSheet = currentBlock?.closest?.(".sr-page-sheet") || this._activePageSheet(controller);
		let nextBody = this._insertPageSheetAfter(controller, "portrait");
		if (!currentSheet || !nextBody) {
			return;
		}
		let moved = [];
		if (currentBlock?.parentNode) {
			let moveFrom = currentBlock.nextElementSibling;
			if (currentBlock.getAttribute("data-block-type") == "paragraph" && state?.editable) {
				let split = this._splitEditableAtSelection(controller, state.editable);
				this._setEditableMarkdown(controller, state.editable, split.before);
				if (!String(split.before || "").trim() && String(split.after || "").trim()) {
					moveFrom = currentBlock;
				}
				else if (String(split.after || "").trim()) {
					moved.push(this._createParagraphBlock(controller, split.after));
				}
			}
			while (moveFrom) {
				let next = moveFrom.nextElementSibling;
				moved.push(moveFrom);
				moveFrom = next;
			}
		}
		if (moved.length) {
			nextBody.replaceChildren();
		}
		for (let node of moved) {
			nextBody.appendChild(node);
		}
		if (!nextBody.children.length) {
			nextBody.appendChild(this._createEmptyParagraphBlock(controller));
		}
		let nextEditable = nextBody.querySelector("[data-sr-editable='true']");
		controller.nativeActiveEditable = nextEditable || controller.nativeActiveEditable;
		this._focusEditableStart(nextEditable);
		this._markNativeEditorDirty(controller);
	},

	_insertPageLayoutBlock(controller, layout) {
		if (controller.mode != "native") {
			this._setWorkspaceMode(controller, "native");
		}
		let nextLayout = String(layout || "").toLowerCase() == "landscape" ? "landscape" : "portrait";
		let state = this._currentInsertionState(controller);
		this._restoreEditorSelectionState(controller, state);
		let sheet = (state?.editable?.closest?.(".sr-page-sheet")) || this._activePageSheet(controller);
		if (sheet) {
			sheet.setAttribute("data-sr-layout", nextLayout);
		}
		else {
			this._insertPageSheetAfter(controller, nextLayout);
		}
		this._markNativeEditorDirty(controller);
	},

	async _insertImageBlock(controller) {
		let current = await this._resolveControllerProject(controller);
		if (!current) {
			throw new Error("Open a collection project first");
		}
		if (controller.mode != "native") {
			this._setWorkspaceMode(controller, "native");
		}
		let state = this._currentInsertionState(controller);
		let fp = Components.classes["@mozilla.org/filepicker;1"]
			.createInstance(Components.interfaces.nsIFilePicker);
		this._initFilePicker(fp, controller, "Choose image", Components.interfaces.nsIFilePicker.modeOpen);
		fp.appendFilter("Images", "*.png; *.jpg; *.jpeg; *.gif; *.webp; *.svg");
		let result = await new Promise((resolve) => fp.open(resolve));
		if (result != Components.interfaces.nsIFilePicker.returnOK || !fp.file) {
			return;
		}
		let picked = fp.file;
		let targetName = this._sanitizeFileName(picked.leafName);
		let destination = this._joinPath(this._parentPath(current.context.reportPath), targetName);
		let counter = 1;
		while (this._pathExists(destination)) {
			let ext = targetName.includes(".") ? targetName.slice(targetName.lastIndexOf(".")) : "";
			let stem = ext ? targetName.slice(0, -ext.length) : targetName;
			destination = this._joinPath(this._parentPath(current.context.reportPath), `${stem}-${counter}${ext}`);
			counter += 1;
		}
		this._copyFileToPath(picked.path, destination);
		let relativePath = this._basename(destination);
		let imageBlock = this._renderNativeBlock(controller, {
			type: "image",
			alt: this._basename(destination),
			src: relativePath,
		}, Date.now());
		let paragraphBlock = this._createParagraphBlock(controller, "");
		let body = state?.editable?.closest?.(".sr-page-editor-body") || this._activePageBody(controller);
		let currentBlock = state?.editable?.closest?.(".sr-native-block");
		if (body) {
			if (currentBlock && currentBlock.parentNode == body) {
				currentBlock.after(imageBlock, paragraphBlock);
			}
			else {
				body.append(imageBlock, paragraphBlock);
			}
			let nextEditable = paragraphBlock.querySelector(".sr-block-editable");
			controller.nativeActiveEditable = nextEditable || controller.nativeActiveEditable;
			this._focusEditableEnd(nextEditable);
			this._markNativeEditorDirty(controller);
		}
	},

	_selectedEditableText(controller) {
		try {
			let selection = controller?.doc?.defaultView?.getSelection?.();
			if (!selection || !selection.rangeCount) {
				return "";
			}
			let anchorNode = selection.anchorNode;
			let focusNode = selection.focusNode;
			let active = controller.nativeActiveEditable;
			if (!active) {
				return "";
			}
			let anchorInside = anchorNode && active.contains(anchorNode.nodeType == 3 ? anchorNode.parentNode : anchorNode);
			let focusInside = focusNode && active.contains(focusNode.nodeType == 3 ? focusNode.parentNode : focusNode);
			if (!anchorInside || !focusInside) {
				return "";
			}
			return String(selection.toString() || "").trim();
		}
		catch (_err) {
			return "";
		}
	},

	async _insertLinkFromDialog(controller) {
		let win = controller.doc.defaultView;
		let state = this._currentInsertionState(controller);
		let selectedText = this._editorSelectionText(state).trim();
		let url = String(win.prompt("Link URL", "https://") || "").trim();
		if (!url) {
			return;
		}
		let label = selectedText || String(win.prompt("Link text", "Link") || "").trim();
		if (!label) {
			return;
		}
		let markdown = `[${label}](${url})`;
		if (controller.mode == "raw") {
			this._insertIntoTextarea(controller.els.rawEditor, markdown);
			controller.documentDirty = true;
			controller.previewStale = true;
			return;
		}
		if (controller.mode != "native") {
			this._setWorkspaceMode(controller, "native");
		}
		let anchorHTML = `<a href="${this._escapeHTML(url)}">${this._escapeHTML(label)}</a>`;
		this._insertHTMLIntoActiveEditable(controller, anchorHTML, () => {
			let body = this._activePageBody(controller);
			if (body) {
				body.appendChild(this._createParagraphBlockWithHTML(controller, anchorHTML));
			}
		}, state);
		this._markNativeEditorDirty(controller);
	},

	_insertBibliographyPlaceholder(controller) {
		if (controller.mode == "raw") {
			let lines = String(controller.els.rawEditor.value || "").split("\n");
			let existingIndex = lines.findIndex((line) => line.trim() == SystematicReviewerNativeMarkdown.BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN);
			if (existingIndex >= 0) {
				lines.splice(existingIndex, 1);
				controller.els.rawEditor.value = lines.join("\n").replace(/\n{3,}/g, "\n\n");
			}
			else {
				this._insertIntoTextarea(controller.els.rawEditor, `${SystematicReviewerNativeMarkdown.BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN}\n`);
			}
			controller.documentDirty = true;
			controller.previewStale = true;
			return;
		}
		if (controller.mode != "native") {
			this._setWorkspaceMode(controller, "native");
		}
		let existingBlock = controller.els.nativeEditor.querySelector("[data-block-type='bibliography']");
		if (existingBlock) {
			this._removeBibliographyBlock(controller, existingBlock);
			return;
		}
		let state = this._currentInsertionState(controller);
		let bibliographyBlock = this._renderNativeBlock(controller, { type: "bibliography" }, Date.now());
		let paragraphBlock = this._createParagraphBlock(controller, "");
		let body = state?.editable?.closest?.(".sr-page-editor-body") || this._activePageBody(controller);
		let currentBlock = state?.editable?.closest?.(".sr-native-block");
		if (body) {
			if (currentBlock && currentBlock.parentNode == body) {
				currentBlock.after(bibliographyBlock, paragraphBlock);
			}
			else {
				body.append(bibliographyBlock, paragraphBlock);
			}
			let nextEditable = paragraphBlock.querySelector(".sr-block-editable");
			controller.nativeActiveEditable = nextEditable || controller.nativeActiveEditable;
			this._focusEditableEnd(nextEditable);
			this._markNativeEditorDirty(controller);
			this._refreshCitationDependentRendering(controller);
		}
	},

	_removeBibliographyBlock(controller, block = null) {
		let existingBlock = block || controller?.els?.nativeEditor?.querySelector?.("[data-block-type='bibliography']");
		if (!existingBlock) {
			return false;
		}
		let body = existingBlock.closest(".sr-page-editor-body");
		let nextBlock = existingBlock.nextElementSibling;
		let previousBlock = existingBlock.previousElementSibling;
		let removableEmptyParagraph =
			nextBlock?.getAttribute?.("data-block-type") == "paragraph"
			&& !String(this._inlineMarkdownFromNode(nextBlock.querySelector(".sr-block-editable")) || "").trim();
		existingBlock.remove();
		if (removableEmptyParagraph) {
			nextBlock.remove();
		}
		let nextEditable =
			previousBlock?.querySelector?.("[data-sr-editable='true']")
			|| nextBlock?.querySelector?.("[data-sr-editable='true']")
			|| body?.querySelector?.("[data-sr-editable='true']")
			|| this._ensureTrailingEditableParagraph(body);
		controller.nativeActiveEditable = nextEditable || controller.nativeActiveEditable;
		if (nextEditable?.getAttribute?.("data-sr-editable") == "true") {
			this._focusEditableEnd(nextEditable);
		}
		this._markNativeEditorDirty(controller);
		this._refreshCitationDependentRendering(controller);
		return true;
	},

	async _insertCitationFromDialog(controller) {
		let current = await this._resolveControllerProject(controller);
		if (!current) {
			throw new Error("Open a collection project first");
		}
		let state = this._currentInsertionState(controller);
		let choice = await this._openCitationPickerDialog(controller, current, null);
		if (!choice || !choice.keys?.length) {
			return;
		}
		let allowedKeys = new Set(this._projectCitableItems(current.collection, current.projectItem).map((item) => item.key));
		choice.keys = choice.keys.filter((key) => allowedKeys.has(key));
		if (!choice.keys.length) {
			return;
		}
		let markdown = SystematicReviewerNativeMarkdown.makeCitationMarkdown(choice);
		let chipHTML = this._citationChipHTML(controller, choice);
		if (controller.mode == "raw") {
			this._insertIntoTextarea(controller.els.rawEditor, markdown);
			controller.documentDirty = true;
			controller.previewStale = true;
			return;
		}
		if (controller.mode != "native") {
			this._setWorkspaceMode(controller, "native");
		}
		this._insertHTMLIntoActiveEditable(controller, chipHTML, () => {
			let body = this._activePageBody(controller);
			if (body) {
				body.appendChild(this._createParagraphBlockWithHTML(controller, chipHTML));
			}
		}, state);
		this._markNativeEditorDirty(controller);
		this._refreshCitationDependentRendering(controller);
	},

	async _editCitationFromNode(controller, citationNode) {
		let current = await this._resolveControllerProject(controller);
		if (!current) {
			throw new Error("Open a collection project first");
		}
		let info = this._citationInfoFromNode(citationNode);
		if (!info) {
			return;
		}
		let choice = await this._openCitationPickerDialog(controller, current, info);
		if (!choice || !choice.keys?.length) {
			return;
		}
		let allowedKeys = new Set(this._projectCitableItems(current.collection, current.projectItem).map((item) => item.key));
		choice.keys = choice.keys.filter((key) => allowedKeys.has(key));
		if (!choice.keys.length) {
			return;
		}
		this._replaceCitationNode(controller, info.node, choice);
	},

	async _openCitationPickerDialog(controller, current, initialCitation = null) {
		let collection = current.collection;
		let allItems = this._projectCitableItems(collection, current.projectItem);
		let itemMap = new Map(allItems.map((item) => [item.key, item]));

		return await new Promise((resolve) => {
			let backdrop = this._html(controller.doc, "div", { className: `sr-dialog-backdrop ${this._themeClassForWindow(controller.doc.defaultView)}` });
			let dialog = this._html(controller.doc, "div", { className: `sr-dialog ${this._themeClassForWindow(controller.doc.defaultView)}` });
			let titleText = initialCitation ? "Edit Citation" : "Add Citation";
			let actionText = initialCitation ? "Save Citation" : "Insert Citation";
			let searchInput = this._html(controller.doc, "input", {
				className: "sr-field-input",
				attrs: { type: "search", placeholder: "Search title, author, year, or journal" },
			});
			let selectionBar = this._html(controller.doc, "div", { className: "sr-dialog-selection" });
			let resultsHeader = this._html(controller.doc, "div", {
				className: "sr-dialog-results-header",
				children: [
					this._html(controller.doc, "div", { text: "Authors" }),
					this._html(controller.doc, "div", { text: "Year" }),
					this._html(controller.doc, "div", { text: "Title" }),
					this._html(controller.doc, "div", { text: "" }),
				],
				});
				let list = this._html(controller.doc, "div", { className: "sr-dialog-list" });
				let resultsStatus = this._html(controller.doc, "div", {
					className: "sr-dialog-subtitle",
					text: "",
				});
				let locatorInput = this._html(controller.doc, "input", {
					className: "sr-field-input",
					attrs: { type: "text", placeholder: "(e.g. p. 12)" },
			});
			let prefixInput = this._html(controller.doc, "input", {
				className: "sr-field-input",
				attrs: { type: "text", placeholder: "Optional prefix" },
			});
			let suffixInput = this._html(controller.doc, "input", {
				className: "sr-field-input",
				attrs: { type: "text", placeholder: "Optional suffix" },
			});
			let selectedKeys = (initialCitation?.keys || []).filter((key) => itemMap.has(key));
			prefixInput.value = initialCitation?.prefix || "";
			locatorInput.value = initialCitation?.locator || "";
			suffixInput.value = initialCitation?.suffix || "";

			let creatorTextFor = (item) => item.getCreators
				? item.getCreators().map((creator) => creator.lastName || creator.name || "").filter(Boolean).join(", ")
				: "";
			let yearTextFor = (item) => this._extractYear(this._itemField(item, "date")) || this._itemField(item, "date") || "";
			let records = allItems.map((item) => {
				let title = this._itemField(item, "title") || "(Untitled)";
				let creators = creatorTextFor(item);
				let year = yearTextFor(item);
				let publication = this._itemField(item, "publicationTitle") || item.itemType || "";
				return {
					item,
					key: item.key,
					title,
					creators,
					year,
					publication,
					haystack: `${title} ${creators} ${year} ${publication}`.toLowerCase(),
				};
			});
			let chipLabelFor = (item) => {
				let creator = creatorTextFor(item).split(",")[0]?.trim();
				let year = yearTextFor(item);
				return creator ? `${creator}, ${year || "n.d."}` : (this._itemField(item, "title") || "(Untitled)");
			};
			let toggleSelected = (itemKey) => {
				let index = selectedKeys.indexOf(itemKey);
				if (index >= 0) {
					selectedKeys.splice(index, 1);
				}
				else {
					selectedKeys.push(itemKey);
				}
			};

			let insertBtn = this._html(controller.doc, "button", { className: "sr-workspace-btn sr-workspace-btn-primary", text: actionText, attrs: { type: "button" } });
				let selectedCountLabel = this._html(controller.doc, "div", {
					className: "sr-dialog-subtitle",
					text: `Selected items: ${selectedKeys.length}`,
				});
				let renderResultsFrame = 0;

			let renderSelection = () => {
				selectionBar.replaceChildren();
				selectedCountLabel.textContent = `Selected items: ${selectedKeys.length}`;
				if (!selectedKeys.length) {
					selectionBar.appendChild(this._html(controller.doc, "div", {
						className: "sr-dialog-selection-empty",
						text: "No selected or open items",
					}));
					insertBtn.disabled = true;
					return;
				}
				insertBtn.disabled = false;
				for (let key of selectedKeys) {
					let item = itemMap.get(key);
					if (!item) {
						continue;
					}
					let removeBtn = this._html(controller.doc, "button", {
						className: "sr-dialog-chip-remove",
						text: "×",
						attrs: { type: "button", "aria-label": "Remove citation item" },
					});
						removeBtn.addEventListener("click", (event) => {
							event.preventDefault();
							event.stopPropagation();
							toggleSelected(key);
							renderSelection();
							renderResults();
						});
					selectionBar.appendChild(this._html(controller.doc, "div", {
						className: "sr-dialog-chip",
						children: [
							this._html(controller.doc, "div", { className: "sr-dialog-chip-label", text: chipLabelFor(item) }),
							removeBtn,
						],
					}));
				}
			};

				let renderResults = () => {
					let q = searchInput.value.trim().toLowerCase();
					let fragment = controller.doc.createDocumentFragment();
					let filtered = q ? records.filter((record) => record.haystack.includes(q)) : records;
					let visible = filtered.length;
					let displayRecords = filtered.slice(0, 250);
					for (let record of displayRecords) {
						let row = this._html(controller.doc, "div", {
							className: `sr-dialog-row${selectedKeys.includes(record.key) ? " selected" : ""}`,
						});
					let addBtn = this._html(controller.doc, "button", {
						className: "sr-workspace-btn sr-dialog-add",
						text: selectedKeys.includes(record.key) ? "−" : "+",
						attrs: {
							type: "button",
							"aria-label": selectedKeys.includes(record.key) ? "Remove citation item" : "Add citation item",
						},
					});
					let toggle = () => {
						toggleSelected(record.key);
						renderSelection();
						renderResults();
					};
					addBtn.addEventListener("click", (event) => {
						event.preventDefault();
						event.stopPropagation();
						toggle();
					});
					row.append(
						this._html(controller.doc, "div", { className: "sr-dialog-col-meta", text: record.creators || "No author" }),
						this._html(controller.doc, "div", { className: "sr-dialog-col-meta", text: record.year || "n.d." }),
						this._html(controller.doc, "div", {
							className: "sr-dialog-col-title",
							children: [
								this._html(controller.doc, "div", { className: "sr-dialog-item-title", text: record.title }),
								this._html(controller.doc, "div", { className: "sr-dialog-item-subtitle", text: record.publication }),
							],
						}),
						this._html(controller.doc, "div", { className: "sr-dialog-col-action", children: [addBtn] }),
					);
					row.addEventListener("click", (event) => {
						event.preventDefault();
						toggle();
					});
						fragment.appendChild(row);
					}
					if (!displayRecords.length) {
						fragment.appendChild(this._html(controller.doc, "div", {
							className: "sr-workspace-empty",
							text: "No items match that search.",
						}));
					}
					if (!visible) {
						resultsStatus.textContent = "No papers found.";
					}
					else if (displayRecords.length < visible) {
						resultsStatus.textContent = `Showing ${displayRecords.length} of ${visible} papers. Refine the search to narrow the list.`;
					}
					else {
						resultsStatus.textContent = `${visible} paper${visible == 1 ? "" : "s"} available.`;
					}
					list.replaceChildren(fragment);
				};
				let scheduleResultsRender = () => {
					if (renderResultsFrame) {
						controller.doc.defaultView.cancelAnimationFrame(renderResultsFrame);
					}
					renderResultsFrame = controller.doc.defaultView.requestAnimationFrame(() => {
						renderResultsFrame = 0;
						renderResults();
					});
				};
				searchInput.addEventListener("input", scheduleResultsRender);

			let closeBtn = this._html(controller.doc, "button", {
				className: "sr-workspace-btn sr-dialog-close",
				text: "X",
				attrs: { type: "button", "aria-label": "Close" },
			});
			let cancelBtn = this._html(controller.doc, "button", { className: "sr-workspace-btn", text: "Cancel", attrs: { type: "button" } });
			let keyHandler = null;
				let close = (value) => {
					if (keyHandler) {
						controller.doc.defaultView.removeEventListener("keydown", keyHandler, true);
					}
					if (renderResultsFrame) {
						controller.doc.defaultView.cancelAnimationFrame(renderResultsFrame);
						renderResultsFrame = 0;
					}
					backdrop.remove();
					resolve(value || null);
				};
			keyHandler = (event) => {
				if (event.key == "Escape") {
					event.preventDefault();
					close(null);
				}
			};
			controller.doc.defaultView.addEventListener("keydown", keyHandler, true);
			backdrop.addEventListener("click", (event) => {
				if (event.target === backdrop) {
					close(null);
				}
			});
			closeBtn.addEventListener("click", () => close(null));
			cancelBtn.addEventListener("click", () => close(null));
			insertBtn.addEventListener("click", () => close({
				keys: selectedKeys.slice(),
				locator: locatorInput.value.trim(),
				prefix: prefixInput.value.trim(),
				suffix: suffixInput.value.trim(),
			}));

			dialog.append(
				this._html(controller.doc, "div", {
					className: "sr-dialog-header",
					children: [
						this._html(controller.doc, "div", {
							className: "sr-dialog-heading",
							children: [
								this._html(controller.doc, "div", { className: "sr-dialog-title", text: titleText }),
								this._html(controller.doc, "div", {
									className: "sr-dialog-subtitle",
									text: `Only papers from "${current.context.collectionName}" and its subcollections are available here.`,
								}),
							],
						}),
						closeBtn,
					],
				}),
				this._html(controller.doc, "div", {
					className: "sr-dialog-body",
					children: [
						this._html(controller.doc, "div", {
							className: "sr-dialog-main",
							children: [
								searchInput,
								resultsStatus,
								this._html(controller.doc, "div", {
									className: "sr-dialog-results",
									children: [resultsHeader, list],
								}),
							],
						}),
						this._html(controller.doc, "div", {
							className: "sr-dialog-side",
							children: [
								selectedCountLabel,
								selectionBar,
								this._html(controller.doc, "label", { className: "sr-field-label", text: "Prefix", children: [prefixInput] }),
								this._html(controller.doc, "label", { className: "sr-field-label", text: "Locator", children: [locatorInput] }),
								this._html(controller.doc, "label", { className: "sr-field-label", text: "Suffix", children: [suffixInput] }),
								this._html(controller.doc, "div", {
									className: "sr-workspace-empty",
									text: initialCitation
										? "Save replaces the whole selected citation in the document."
										: "Insert adds the selected citation at the current cursor position.",
								}),
							],
						}),
					],
				}),
				this._html(controller.doc, "div", {
					className: "sr-dialog-footer",
					children: [
						this._html(controller.doc, "div", {
							className: "sr-dialog-subtitle",
							text: "Click a row or use + / - to add and remove papers.",
						}),
						this._html(controller.doc, "div", {
							className: "sr-workspace-toolbar",
							children: [cancelBtn, insertBtn],
						}),
					],
				})
			);
			renderSelection();
			renderResults();
			backdrop.appendChild(dialog);
			this._overlayHost(controller)?.appendChild(backdrop);
			searchInput.focus();
		});
	},

	_captureEditorSelectionState(controller, target) {
		let editable = target?.closest?.("[data-sr-editable='true']") || controller.nativeActiveEditable || null;
		let state = {
			target: target || null,
			editable,
			citationNode: target?.closest?.(".sr-citation-chip") || null,
			bibliographyBlock: target?.closest?.("[data-block-type='bibliography']") || null,
			tableCell: target?.closest?.(".sr-native-table-cell, td, th") || null,
			range: null,
			textareaStart: null,
			textareaEnd: null,
		};
		if (editable?.tagName?.toLowerCase() == "textarea") {
			state.textareaStart = editable.selectionStart ?? 0;
			state.textareaEnd = editable.selectionEnd ?? state.textareaStart;
			return state;
		}
		try {
			let selection = controller.doc.defaultView.getSelection();
			if (!selection || !selection.rangeCount) {
				return state;
			}
			let range = selection.getRangeAt(0);
			let container = range.commonAncestorContainer?.nodeType == 3
				? range.commonAncestorContainer.parentNode
				: range.commonAncestorContainer;
			if (controller.els.nativeEditor.contains(container)) {
				state.range = range.cloneRange();
				let startEditable = this._selectionBoundaryEditableFromRange(range, "start");
				let endEditable = this._selectionBoundaryEditableFromRange(range, "end");
				if (!editable || (startEditable && editable !== startEditable && editable !== endEditable)) {
					state.editable = startEditable || endEditable || editable;
				}
			}
		}
		catch (_err) {}
		return state;
	},

	_restoreEditorSelectionState(controller, state) {
		if (!state) {
			return;
		}
		if (state.editable) {
			controller.nativeActiveEditable = state.editable;
		}
		if (state.editable?.tagName?.toLowerCase() == "textarea") {
			state.editable.focus();
			if (state.textareaStart !== null && state.textareaEnd !== null) {
				state.editable.setSelectionRange(state.textareaStart, state.textareaEnd);
			}
			return;
		}
		try {
			let selection = controller.doc.defaultView.getSelection();
			if (!selection) {
				return;
			}
			selection.removeAllRanges();
			if (state.range) {
				selection.addRange(state.range);
			}
			state.editable?.focus?.();
		}
		catch (_err) {}
	},

	_editorHasSelection(state) {
		if (!state) {
			return false;
		}
		if (state.editable?.tagName?.toLowerCase() == "textarea") {
			return (state.textareaEnd ?? 0) > (state.textareaStart ?? 0);
		}
		return !!(state.range && !state.range.collapsed);
	},

	_editorSelectionText(state) {
		if (!state) {
			return "";
		}
		if (state.editable?.tagName?.toLowerCase() == "textarea") {
			let value = state.editable.value || "";
			let start = state.textareaStart ?? 0;
			let end = state.textareaEnd ?? start;
			return value.slice(start, end);
		}
		if (state.range && !state.range.collapsed) {
			return String(state.range.toString() || "");
		}
		if (state.citationNode) {
			return state.citationNode.getAttribute("data-sr-markdown") || state.citationNode.textContent || "";
		}
		return "";
	},

	_writeClipboardText(text) {
		try {
			Components.classes["@mozilla.org/widget/clipboardhelper;1"]
				.getService(Components.interfaces.nsIClipboardHelper)
				.copyString(String(text || ""));
			return true;
		}
		catch (_err) {
			return false;
		}
	},

	_readClipboardText() {
		try {
			let transferable = Components.classes["@mozilla.org/widget/transferable;1"]
				.createInstance(Components.interfaces.nsITransferable);
			transferable.init(null);
			transferable.addDataFlavor("text/unicode");
			Services.clipboard.getData(transferable, Components.interfaces.nsIClipboard.kGlobalClipboard);
			let data = {};
			let length = {};
			transferable.getTransferData("text/unicode", data, length);
			if (!data.value) {
				return "";
			}
			let supports = data.value.QueryInterface(Components.interfaces.nsISupportsString);
			return String(supports.data || "").slice(0, Math.floor((length.value || 0) / 2));
		}
		catch (_err) {
			return "";
		}
	},

	_replaceSelectedTextInTextarea(textarea, text) {
		let start = textarea.selectionStart ?? textarea.value.length;
		let end = textarea.selectionEnd ?? start;
		let before = textarea.value.slice(0, start);
		let after = textarea.value.slice(end);
		textarea.value = `${before}${text}${after}`;
		let nextPos = before.length + text.length;
		textarea.focus();
		textarea.setSelectionRange(nextPos, nextPos);
	},

	_deleteEditorSelection(controller, state) {
		if (!state) {
			return;
		}
		if (state.editable?.tagName?.toLowerCase() == "textarea") {
			this._replaceSelectedTextInTextarea(state.editable, "");
			return;
		}
		let normalizeAfter = this._selectionSpansMultipleEditables(state);
		let preferredEditable = this._selectionBoundaryEditableFromRange(state.range, "start") || state.editable || null;
		this._restoreEditorSelectionState(controller, state);
		try {
			let selection = controller.doc.defaultView.getSelection();
			if (selection?.deleteFromDocument) {
				selection.deleteFromDocument();
			}
			else {
				let range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
				range?.deleteContents?.();
			}
		}
		catch (_err) {
			try {
				controller.doc.execCommand("delete", false, null);
			}
			catch (_err2) {}
		}
		if (controller?.mode == "native" && normalizeAfter) {
			this._normalizeNativeEditorAfterMutation(controller, preferredEditable);
		}
	},

	_insertTextIntoEditor(controller, state, text) {
		if (state?.editable?.tagName?.toLowerCase() == "textarea") {
			this._replaceSelectedTextInTextarea(state.editable, text);
			return;
		}
		this._restoreEditorSelectionState(controller, state);
		try {
			if (controller.doc.execCommand("insertText", false, text)) {
				return;
			}
		}
		catch (_err) {}
		try {
			let selection = controller.doc.defaultView.getSelection();
			if (!selection || !selection.rangeCount) {
				return;
			}
			let range = selection.getRangeAt(0);
			range.deleteContents();
			let node = controller.doc.createTextNode(text);
			range.insertNode(node);
			range.setStartAfter(node);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
		}
		catch (_err) {}
	},

	_replaceCitationNode(controller, citationNode, choice) {
		let target = citationNode?.closest?.(".sr-citation-chip");
		if (!target) {
			return;
		}
		let holder = this._html(controller.doc, "div");
		holder.innerHTML = this._citationChipHTML(controller, choice);
		let replacement = holder.firstElementChild;
		if (!replacement) {
			return;
		}
		let editable = target.closest("[data-sr-editable='true']");
		target.replaceWith(replacement);
		controller.nativeActiveEditable = editable || controller.nativeActiveEditable;
		this._markNativeEditorDirty(controller);
		this._refreshCitationDependentRendering(controller);
	},

	_tableContextState(controller, state) {
		let tableCell = state?.tableCell?.closest?.("td, th") || null;
		let descriptor = this._tableCellDescriptor(tableCell);
		let table = tableCell?.closest?.("table") || null;
		let tableBlock = tableCell?.closest?.(".sr-block-table") || null;
		if (!tableCell || !descriptor || !table || !tableBlock) {
			return null;
		}
		let selectedCells = this._selectedTableCellsForTarget(controller, tableCell);
		return {
			tableCell,
			descriptor,
			table,
			tableBlock,
			selectedCells,
			canMerge: this._canMergeTableCells(selectedCells),
		};
	},

	_closeEditorContextMenu(controller) {
		let state = controller?.contextMenuState;
		if (!state) {
			return;
		}
		try {
			state.cleanup?.();
		}
		catch (_err) {}
		try {
			state.menu?.remove?.();
		}
		catch (_err) {}
		controller.contextMenuState = null;
	},

	async _performEditorContextAction(controller, state, action) {
		if (!state) {
			return;
		}
		if (action == "copy") {
			let text = this._editorSelectionText(state);
			if (text) {
				this._writeClipboardText(text);
			}
			return;
		}
		if (action == "cut") {
			if (state.citationNode && !this._editorHasSelection(state)) {
				let text = state.citationNode.getAttribute("data-sr-markdown") || state.citationNode.textContent || "";
				if (text) {
					this._writeClipboardText(text);
				}
				state.citationNode.remove();
				this._markNativeEditorDirty(controller);
				this._refreshCitationDependentRendering(controller);
				return;
			}
			let text = this._editorSelectionText(state);
			if (text) {
				this._writeClipboardText(text);
			}
			this._deleteEditorSelection(controller, state);
			this._markNativeEditorDirty(controller);
			return;
		}
		if (action == "paste") {
			let text = this._readClipboardText();
			if (!text) {
				return;
			}
			this._insertTextIntoEditor(controller, state, text);
			this._markNativeEditorDirty(controller);
			return;
		}
		if (action == "edit-citation") {
			await this._editCitationFromNode(controller, state.citationNode);
			return;
		}
		if (action == "remove-bibliography" && state?.bibliographyBlock) {
			this._removeBibliographyBlock(controller, state.bibliographyBlock);
			return;
		}
		let tableContext = this._tableContextState(controller, state);
		if (action == "table-row-above" && tableContext) {
			let current = this._nativeTableBlockFromElement(tableContext.tableBlock);
			let targetRowIndex = tableContext.descriptor.section == "body" ? tableContext.descriptor.rowIndex : 0;
			let next = this._insertRowIntoTableBlock(current, targetRowIndex);
			this._replaceNativeTableBlock(controller, tableContext.tableBlock, next, {
				focusCell: { section: "body", rowIndex: targetRowIndex, columnIndex: tableContext.descriptor.columnIndex, colspan: 1 },
				selectionCells: [{ section: "body", rowIndex: targetRowIndex, columnIndex: tableContext.descriptor.columnIndex, colspan: 1 }],
			});
			return;
		}
		if (action == "table-row-below" && tableContext) {
			let current = this._nativeTableBlockFromElement(tableContext.tableBlock);
			let targetRowIndex = tableContext.descriptor.section == "body" ? tableContext.descriptor.rowIndex + 1 : 0;
			let next = this._insertRowIntoTableBlock(current, targetRowIndex);
			this._replaceNativeTableBlock(controller, tableContext.tableBlock, next, {
				focusCell: { section: "body", rowIndex: targetRowIndex, columnIndex: tableContext.descriptor.columnIndex, colspan: 1 },
				selectionCells: [{ section: "body", rowIndex: targetRowIndex, columnIndex: tableContext.descriptor.columnIndex, colspan: 1 }],
			});
			return;
		}
		if (action == "table-column-left" && tableContext) {
			let current = this._nativeTableBlockFromElement(tableContext.tableBlock);
			let boundaryIndex = tableContext.descriptor.columnIndex;
			let next = this._insertColumnIntoTableBlock(current, boundaryIndex);
			this._replaceNativeTableBlock(controller, tableContext.tableBlock, next, {
				focusCell: {
					section: tableContext.descriptor.section == "header" ? "header" : "body",
					rowIndex: tableContext.descriptor.section == "header" ? 0 : tableContext.descriptor.rowIndex,
					columnIndex: boundaryIndex,
					colspan: 1,
				},
				selectionCells: [{
					section: tableContext.descriptor.section == "header" ? "header" : "body",
					rowIndex: tableContext.descriptor.section == "header" ? 0 : tableContext.descriptor.rowIndex,
					columnIndex: boundaryIndex,
					colspan: 1,
				}],
			});
			return;
		}
		if (action == "table-column-right" && tableContext) {
			let current = this._nativeTableBlockFromElement(tableContext.tableBlock);
			let boundaryIndex = tableContext.descriptor.columnIndex + tableContext.descriptor.colspan;
			let next = this._insertColumnIntoTableBlock(current, boundaryIndex);
			this._replaceNativeTableBlock(controller, tableContext.tableBlock, next, {
				focusCell: {
					section: tableContext.descriptor.section == "header" ? "header" : "body",
					rowIndex: tableContext.descriptor.section == "header" ? 0 : tableContext.descriptor.rowIndex,
					columnIndex: boundaryIndex,
					colspan: 1,
				},
				selectionCells: [{
					section: tableContext.descriptor.section == "header" ? "header" : "body",
					rowIndex: tableContext.descriptor.section == "header" ? 0 : tableContext.descriptor.rowIndex,
					columnIndex: boundaryIndex,
					colspan: 1,
				}],
			});
			return;
		}
		if (["table-align-left", "table-align-center", "table-align-right"].includes(action) && tableContext) {
			let align = action.replace("table-align-", "");
			let current = this._nativeTableBlockFromElement(tableContext.tableBlock);
			let next = this._applyAlignmentToTableBlock(current, tableContext.selectedCells, align);
			this._replaceNativeTableBlock(controller, tableContext.tableBlock, next, {
				focusCell: tableContext.descriptor,
				selectionCells: tableContext.selectedCells,
			});
			return;
		}
		if (action == "table-merge" && tableContext) {
			let current = this._nativeTableBlockFromElement(tableContext.tableBlock);
			let next = this._mergeTableCellsInBlock(current, tableContext.selectedCells);
			if (!next) {
				return;
			}
			let focusCell = {
				section: "body",
				rowIndex: tableContext.selectedCells[0].rowIndex,
				columnIndex: tableContext.selectedCells[0].columnIndex,
				colspan: tableContext.selectedCells.reduce((sum, cell) => sum + cell.colspan, 0),
			};
			this._replaceNativeTableBlock(controller, tableContext.tableBlock, next, {
				focusCell,
				selectionCells: [focusCell],
			});
			return;
		}
		if (action == "edit-raw-table") {
			await this._editRawTableForCell(controller, state.tableCell);
		}
	},

	async _openEditorContextMenu(controller, event, target) {
		if (controller.mode != "native") {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this._closeEditorContextMenu(controller);
		let state = this._captureEditorSelectionState(controller, target);
		if (state.editable) {
			controller.nativeActiveEditable = state.editable;
		}
		let items = [
			{ id: "cut", label: "Cut", disabled: !this._editorHasSelection(state) && !state.citationNode },
			{ id: "copy", label: "Copy", disabled: !this._editorHasSelection(state) && !state.citationNode },
			{ id: "paste", label: "Paste", disabled: false },
		];
		if (state.citationNode || state.bibliographyBlock || state.tableCell) {
			items.push({ separator: true });
		}
		if (state.citationNode) {
			items.push({ id: "edit-citation", label: "Edit Citation…", disabled: false });
		}
		if (state.bibliographyBlock) {
			items.push({ id: "remove-bibliography", label: "Remove Bibliography", disabled: false });
		}
		let tableContext = this._tableContextState(controller, state);
		if (tableContext) {
			items.push(
				{ id: "table-row-above", label: "Insert Row Above", disabled: false },
				{ id: "table-row-below", label: "Insert Row Below", disabled: false },
				{ id: "table-column-left", label: "Insert Column Left", disabled: false },
				{ id: "table-column-right", label: "Insert Column Right", disabled: false },
				{ id: "table-merge", label: "Merge Cells", disabled: !tableContext.canMerge },
				{ separator: true },
				{ id: "table-align-left", label: "Align Column Left", disabled: false },
				{ id: "table-align-center", label: "Align Column Center", disabled: false },
				{ id: "table-align-right", label: "Align Column Right", disabled: false },
				{ separator: true },
				{ id: "edit-raw-table", label: "Edit Raw Table…", disabled: false },
			);
		}
		if (items.every((item) => item.separator || item.disabled)) {
			return;
		}
		let menu = this._html(controller.doc, "div", {
			className: `sr-context-menu ${this._themeClassForWindow(controller.doc.defaultView)}`.trim(),
		});
		menu.addEventListener("contextmenu", (menuEvent) => {
			menuEvent.preventDefault();
			menuEvent.stopPropagation();
		}, true);
		menu.addEventListener("mousedown", (menuEvent) => menuEvent.stopPropagation(), true);
		for (let item of items) {
			if (item.separator) {
				menu.appendChild(this._html(controller.doc, "div", { className: "sr-context-menu-separator" }));
				continue;
			}
			let button = this._html(controller.doc, "button", {
				className: "sr-context-menu-item",
				text: item.label,
				attrs: { type: "button" },
			});
			if (item.disabled) {
				button.disabled = true;
			}
			else {
				button.addEventListener("mousedown", (menuEvent) => {
					menuEvent.preventDefault();
					menuEvent.stopPropagation();
				});
				button.addEventListener("click", (menuEvent) => {
					menuEvent.preventDefault();
					menuEvent.stopPropagation();
					this._closeEditorContextMenu(controller);
					this._performEditorContextAction(controller, state, item.id).catch((error) => this._showError(error));
				});
			}
			menu.appendChild(button);
		}
		this._overlayHost(controller)?.appendChild(menu);
		let maxLeft = Math.max(8, controller.doc.defaultView.innerWidth - menu.offsetWidth - 8);
		let maxTop = Math.max(8, controller.doc.defaultView.innerHeight - menu.offsetHeight - 8);
		menu.style.left = `${Math.max(8, Math.min(event.clientX, maxLeft))}px`;
		menu.style.top = `${Math.max(8, Math.min(event.clientY, maxTop))}px`;
		let closeHandler = (closeEvent) => {
			let closeTarget = closeEvent.target?.nodeType == 3 ? closeEvent.target.parentNode : closeEvent.target;
			if (closeTarget && menu.contains(closeTarget)) {
				return;
			}
			this._closeEditorContextMenu(controller);
		};
		let keyHandler = (keyEvent) => {
			if (keyEvent.key == "Escape") {
				keyEvent.preventDefault();
				this._closeEditorContextMenu(controller);
			}
		};
		controller.doc.defaultView.addEventListener("mousedown", closeHandler, true);
		controller.doc.defaultView.addEventListener("scroll", closeHandler, true);
		controller.doc.defaultView.addEventListener("keydown", keyHandler, true);
		controller.contextMenuState = {
			menu,
			cleanup: () => {
				controller.doc.defaultView.removeEventListener("mousedown", closeHandler, true);
				controller.doc.defaultView.removeEventListener("scroll", closeHandler, true);
				controller.doc.defaultView.removeEventListener("keydown", keyHandler, true);
			},
		};
	},

	_insertHTMLIntoActiveEditable(controller, html, fallback, state = null) {
		let effectiveState = state || this._currentInsertionState(controller);
		let editable = effectiveState?.editable || controller.nativeActiveEditable;
		if (!editable) {
			fallback?.();
			return;
		}
		this._restoreEditorSelectionState(controller, effectiveState);
		editable.focus();
		try {
			let selection = controller.doc.defaultView.getSelection();
			let range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
			let pageBody = editable.closest?.(".sr-page-editor-body") || this._activePageBody(controller);
			let container = range?.commonAncestorContainer?.nodeType == 3
				? range.commonAncestorContainer.parentNode
				: range?.commonAncestorContainer || null;
			let rangeWithinContext = !!(
				range
				&& container
				&& controller.els.nativeEditor.contains(container)
				&& (
					container === editable
					|| editable.contains?.(container)
					|| pageBody?.contains?.(container)
				)
			);
			if (!rangeWithinContext) {
				range = controller.doc.createRange();
				range.selectNodeContents(editable);
				range.collapse(false);
				selection.removeAllRanges();
				selection.addRange(range);
			}
			range.deleteContents();
			let fragment = range.createContextualFragment(html);
			let lastNode = fragment.lastChild;
			range.insertNode(fragment);
			if (lastNode) {
				range.setStartAfter(lastNode);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
			}
			controller.lastSelectionState = this._captureEditorSelectionState(controller, editable);
		}
		catch (_err) {
			fallback?.();
		}
	},

	async _editRawTableForCell(controller, cell) {
		let block = cell?.closest?.(".sr-block-table");
		let target = this._nativeTableBlockFromElement(block);
		if (!target) {
			return;
		}
		let raw = SystematicReviewerNativeMarkdown.serializeBlocks([target]).trim();
		controller.els.rawEditor.value = raw;
		this._setWorkspaceMode(controller, "raw");
		controller.els.rawEditor.focus();
		controller.els.rawEditor.select();
	},

	async _submitChat(controller) {
		let message = controller.els.chatInput.value.trim();
		if (!message) {
			return;
		}
		let current = await this._resolveControllerProject(controller);
		if (!current) {
			throw new Error("Open a collection project first");
		}
		let sessionID = await this._ensureActiveSession(current.context);
		controller.projectRef = this._projectReferenceData(current, { sessionID });
		controller.els.chatInput.value = "";
		this._setStatus(controller, "Running session...", "");
		await this._sessionMessage(current, sessionID, message, {
			origin: "ui",
			emitProgress: true,
		});
		await this._refreshAllControllers();
		this._setStatus(controller, "Session updated", "ready");
	},

	async _handleLocalCommand(current, sessionID, message) {
		let command = message.trim();
		if (!command.startsWith("/")) {
			return "Saved to the active collection session.";
		}

		let lower = command.toLowerCase();
		if (lower == "/help") {
			return [
				"Commands:",
				"- /Autodrive: Keep the agent working for a chosen number of turns with optional reviewer checks.",
				"- /find: Find Arguments in project markdown chunks using keyword search, or semantic search when full-text embeddings are ready.",
				"- /explore: Run scoped synthesis over selected Explore columns with @{column_key} placeholders.",
				"- /status: Show the current project scope and tracked item counts.",
				"- /help: Show this guide.",
				"",
				"The agent can help screen, extract, synthesize tables, search project documents, and revise REPORT.md.",
			].join("\n");
		}
		if (lower == "/autodrive" || lower.startsWith("/autodrive ")) {
			return "Use /Autodrive in Automation chat to choose the turn count, reviewer mode, and per-run prompt before starting.";
		}
		if (lower == "/status") {
			let counts = await this._projectCounts(current.context);
			return [
				`Collection: ${current.context.collectionName}`,
				`Project item: ${current.projectItem.key}`,
				`Collections tracked: ${counts.collections}`,
				`Items tracked: ${counts.items}`,
				`Attachments tracked: ${counts.attachments}`,
				`Project files linked: ${counts.artifacts}`,
				`Source links: ${counts.source_links}`,
			].join("\n");
		}
		if (lower == "/find" || lower.startsWith("/find ")) {
			return "Use /find in Automation chat, choose Keyword or Semantic, then type the query in the same composer.";
		}
		if (lower == "/explore" || lower.startsWith("/explore ")) {
			return "Use /explore in Automation chat with one or more @{column_key} placeholders, then choose the project scope.";
		}
		return "Unknown command. Use /help, /Autodrive, /find, /explore, or /status.";
	},

		_ensureTrailingEditableParagraph(pageBody) {
			if (!pageBody) {
				return null;
		}
		let children = Array.from(pageBody.children).filter(Boolean);
		let last = children[children.length - 1] || null;
		let lastEditable = last?.querySelector?.(".sr-block-editable");
		let isBlankParagraph =
			last?.classList?.contains("sr-block-paragraph")
			&& lastEditable
			&& !String(lastEditable.textContent || "").trim()
			&& !last.querySelector("img,table,figure");
		if (isBlankParagraph) {
			return lastEditable;
		}
		let paragraphBlock = this._createEmptyParagraphBlock({ doc: pageBody.ownerDocument });
			pageBody.appendChild(paragraphBlock);
			return paragraphBlock.querySelector(".sr-block-editable");
		},

		_focusNearestEditableForPageClick(controller, pageBody, event) {
			if (!pageBody) {
				return null;
			}
			let blocks = Array.from(pageBody.children || []).filter((child) => child?.classList?.contains("sr-native-block"));
			if (!blocks.length) {
				let paragraph = this._ensureTrailingEditableParagraph(pageBody);
				if (paragraph) {
					this._focusEditableEnd(paragraph);
				}
				return paragraph;
			}
			let y = Number(event?.clientY || 0);
			let firstRect = blocks[0].getBoundingClientRect();
			if (y < firstRect.top - 10) {
				let firstEditable = this._firstEditableInNode(blocks[0]);
				if (firstEditable) {
					this._focusEditableStart(firstEditable);
				}
				return firstEditable;
			}
			let lastBlock = blocks[blocks.length - 1];
			let lastRect = lastBlock.getBoundingClientRect();
			if (y > lastRect.bottom + 14) {
				let paragraph = this._ensureTrailingEditableParagraph(pageBody);
				if (paragraph) {
					this._focusEditableEnd(paragraph);
				}
				return paragraph;
			}
			let closestBlock = blocks[0];
			let closestRect = blocks[0].getBoundingClientRect();
			let closestDistance = Number.POSITIVE_INFINITY;
			for (let block of blocks) {
				let rect = block.getBoundingClientRect();
				let distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
				if (distance < closestDistance) {
					closestDistance = distance;
					closestBlock = block;
					closestRect = rect;
				}
			}
			let editable = this._lastEditableInNode(closestBlock) || this._firstEditableInNode(closestBlock);
			if (!editable) {
				return null;
			}
			if (y <= closestRect.top + 6) {
				this._focusEditableStart(editable);
			}
			else {
				this._focusEditableEnd(editable);
			}
			return editable;
		},

		_createEmptyParagraphBlock(controller) {
			let doc = controller.doc || controller;
		let wrapper = this._html(doc, "section", {
			className: "sr-native-block sr-block-paragraph",
			attrs: { "data-block-type": "paragraph" },
		});
		let editable = this._html(doc, "div", {
			className: "sr-block-editable",
			attrs: {
				contenteditable: "true",
				"data-sr-editable": "true",
			},
		});
		editable.innerHTML = "<br />";
		wrapper.appendChild(editable);
		return wrapper;
	},

		_insertIntoTextarea(textarea, insertText) {
			let start = textarea.selectionStart ?? textarea.value.length;
			let end = textarea.selectionEnd ?? start;
			let before = textarea.value.slice(0, start);
		let after = textarea.value.slice(end);
		textarea.value = `${before}${insertText}${after}`;
		let nextPos = before.length + insertText.length;
			textarea.setSelectionRange(nextPos, nextPos);
			textarea.focus();
		},

		_isMacBackwardDeleteKey(controller, event) {
			let platform = String(controller?.doc?.defaultView?.navigator?.platform || "");
			return /mac/i.test(platform)
				&& event?.key == "Delete"
				&& !event.metaKey
				&& !event.ctrlKey
				&& !event.altKey;
		},

		_deleteBackwardInTextarea(textarea) {
			if (!textarea) {
				return false;
			}
			let start = textarea.selectionStart ?? 0;
			let end = textarea.selectionEnd ?? start;
			if (start == end && start <= 0) {
				return false;
			}
			let before = textarea.value.slice(0, start);
			let after = textarea.value.slice(end);
			if (start != end) {
				textarea.value = `${textarea.value.slice(0, start)}${after}`;
				textarea.setSelectionRange(start, start);
				return true;
			}
			let nextPos = Math.max(0, start - 1);
			textarea.value = `${before.slice(0, -1)}${after}`;
			textarea.setSelectionRange(nextPos, nextPos);
			return true;
		},

		_deleteBackwardInEditable(controller, editable) {
			if (!editable || editable.tagName?.toLowerCase() == "textarea") {
				return false;
			}
			try {
				let selection = controller.doc.defaultView.getSelection();
				if (!selection || !selection.rangeCount) {
					return false;
				}
				let range = selection.getRangeAt(0);
				let common = range.commonAncestorContainer?.nodeType == 3
					? range.commonAncestorContainer.parentNode
					: range.commonAncestorContainer;
				if (common && common !== editable && !editable.contains(common)) {
					return false;
				}
				if (!range.collapsed) {
					range.deleteContents();
					selection.removeAllRanges();
					selection.addRange(range);
					return true;
				}
				if (typeof selection.modify == "function") {
					let snapshot = range.cloneRange();
					selection.modify("extend", "backward", "character");
					if (!selection.rangeCount) {
						selection.removeAllRanges();
						selection.addRange(snapshot);
						return false;
					}
					let deleteRange = selection.getRangeAt(0);
					let deleteCommon = deleteRange.commonAncestorContainer?.nodeType == 3
						? deleteRange.commonAncestorContainer.parentNode
						: deleteRange.commonAncestorContainer;
					if (deleteCommon && deleteCommon !== editable && !editable.contains(deleteCommon)) {
						selection.removeAllRanges();
						selection.addRange(snapshot);
						return false;
					}
					deleteRange.deleteContents();
					selection.removeAllRanges();
					selection.addRange(deleteRange);
					return true;
				}
				if (range.startContainer?.nodeType == 3 && range.startOffset > 0) {
					range.startContainer.deleteData(range.startOffset - 1, 1);
					range.setStart(range.startContainer, range.startOffset - 1);
					range.collapse(true);
					selection.removeAllRanges();
					selection.addRange(range);
					return true;
				}
			}
			catch (_err) {}
			return false;
		},
};
