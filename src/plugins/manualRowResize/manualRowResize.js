import BasePlugin from './../_base';
import { addClass, hasClass, removeClass, outerWidth } from './../../helpers/dom/element';
import EventManager from './../../eventManager';
import { pageY } from './../../helpers/dom/event';
import { arrayEach } from './../../helpers/array';
import { rangeEach } from './../../helpers/number';
import { registerPlugin } from './../../plugins';

// Developer note! Whenever you make a change in this file, make an analogous change in manualRowResize.js

/**
 * @description
 * This plugin allows to change rows height. To make rows height persistent the {@link Options#persistentState}
 * plugin should be enabled.
 *
 * The plugin creates additional components to make resizing possibly using user interface:
 * - handle - the draggable element that sets the desired height of the row.
 * - guide - the helper guide that shows the desired height as a horizontal guide.
 *
 * @plugin ManualRowResize
 */
class ManualRowResize extends BasePlugin {
  constructor(hotInstance) {
    super(hotInstance);

    this.currentTH = null;
    this.currentRow = null;
    this.selectedRows = [];
    this.currentHeight = null;
    this.newSize = null;
    this.startY = null;
    this.startHeight = null;
    this.startOffset = null;
    this.handle = document.createElement('DIV');
    this.guide = document.createElement('DIV');
    this.tooltip = document.createElement('DIV');
    this.eventManager = new EventManager(this);
    this.pressed = null;
    this.dblclick = 0;
    this.autoresizeTimeout = null;
    this.manualRowHeights = [];

    addClass(this.handle, 'manualRowResizer');
    addClass(this.guide, 'manualRowResizerGuide');
    addClass(this.tooltip, 'manualRowResizerTooltip');
  }

  /**
   * Checks if the plugin is enabled in the handsontable settings. This method is executed in {@link Hooks#beforeInit}
   * hook and if it returns `true` than the {@link ManualRowResize#enablePlugin} method is called.
   *
   * @returns {Boolean}
   */
  isEnabled() {
    return this.hot.getSettings().manualRowResize;
  }

  /**
   * Enables the plugin functionality for this Handsontable instance.
   */
  enablePlugin() {
    if (this.enabled) {
      return;
    }

    this.manualRowHeights = [];

    const initialRowHeights = this.hot.getSettings().manualRowResize;
    const loadedManualRowHeights = this.loadManualRowHeights();

    if (typeof loadedManualRowHeights !== 'undefined') {
      this.manualRowHeights = loadedManualRowHeights;
    } else if (Array.isArray(initialRowHeights)) {
      this.manualRowHeights = initialRowHeights;
    } else {
      this.manualRowHeights = [];
    }

    this.addHook('modifyRowHeight', (height, row) => this.onModifyRowHeight(height, row));

    // Handsontable.hooks.register('beforeRowResize');
    // Handsontable.hooks.register('afterRowResize');

    this.bindEvents();

    super.enablePlugin();
  }

  /**
   * Updates the plugin state. This method is executed when {@link Core#updateSettings} is invoked.
   */
  updatePlugin() {
    const initialRowHeights = this.hot.getSettings().manualRowResize;

    if (Array.isArray(initialRowHeights)) {
      this.manualRowHeights = initialRowHeights;

    } else if (!initialRowHeights) {
      this.manualRowHeights = [];
    }
  }

  /**
   * Disables the plugin functionality for this Handsontable instance.
   */
  disablePlugin() {
    super.disablePlugin();
  }

  /**
   * Saves the current sizes using the persistentState plugin (the {@link Options#persistentState} option has to be enabled).
   * @fires Hooks#persistentStateSave
   * @fires Hooks#manualRowHeights
   */
  saveManualRowHeights() {
    this.hot.runHooks('persistentStateSave', 'manualRowHeights', this.manualRowHeights);
  }

  /**
   * Loads the previously saved sizes using the persistentState plugin (the {@link Options#persistentState} option has to be enabled).
   *
   * @returns {Array}
   * @fires Hooks#persistentStateLoad
   * @fires Hooks#manualRowHeights
   */
  loadManualRowHeights() {
    const storedState = {};

    this.hot.runHooks('persistentStateLoad', 'manualRowHeights', storedState);

    return storedState.value;
  }

  /**
   * Sets the resize handle position.
   *
   * @private
   * @param {HTMLCellElement} TH TH HTML element.
   * @param {MouseEvent} event
   */
  setupHandlePosition(TH, event) {
    if (!TH.parentNode) {
      return false;
    }

    let row = this.hot.view.wt.wtTable.getCoords(TH).row; // getCoords returns CellCoords
    let box;

    if (row > 0) {
      box = TH.getBoundingClientRect();
      const center = (box.top + box.bottom) / 2;
      if (event.clientY < center) {
        TH = TH.parentElement.previousElementSibling.firstChild;
        row -= 1;
        box = null;
      }
    }

    this.currentTH = TH;
    const headerWidth = outerWidth(this.currentTH);

    if (row >= 0) { // if not col header
      box = box || this.currentTH.getBoundingClientRect();

      this.currentRow = row;
      this.selectedRows = [];

      if (this.hot.selection.isSelected() && this.hot.selection.isSelectedByRowHeader()) {
        const { from, to } = this.hot.getSelectedRangeLast();
        let start = from.row;
        let end = to.row;

        if (start >= end) {
          start = to.row;
          end = from.row;
        }

        if (this.currentRow >= start && this.currentRow <= end) {
          rangeEach(start, end, i => this.selectedRows.push(i));

        } else {
          this.selectedRows.push(this.currentRow);
        }
      } else {
        this.selectedRows.push(this.currentRow);
      }

      this.startOffset = box.top - 6;
      this.startHeight = parseInt(box.height, 10);
      this.handle.style.left = `${box.left}px`;
      this.handle.style.top = `${this.startOffset + this.startHeight}px`;
      this.handle.style.width = `${headerWidth}px`;
      this.hot.rootElement.appendChild(this.handle);
    }
  }

  /**
   * Refresh the resize handle position.
   *
   * @private
   */
  refreshHandlePosition() {
    this.handle.style.top = `${this.startOffset + this.currentHeight}px`;
  }

  /**
   * Sets the resize guide position.
   *
   * @private
   */
  setupGuidePosition() {
    const handleWidth = parseInt(outerWidth(this.handle), 10);
    const handleRightPosition = parseInt(this.handle.style.left, 10) + handleWidth;
    const maximumVisibleElementWidth = parseInt(this.hot.view.maximumVisibleElementWidth(0), 10);
    addClass(this.handle, 'active');
    addClass(this.guide, 'active');

    this.guide.style.top = this.handle.style.top;
    this.guide.style.left = `${handleRightPosition}px`;
    this.guide.style.width = `${maximumVisibleElementWidth - handleWidth}px`;
    this.hot.rootElement.appendChild(this.guide);
  }

  /**
   * Refresh the resize guide position.
   *
   * @private
   */
  refreshGuidePosition() {
    this.guide.style.top = this.handle.style.top;
  }

  /**
   * Sets the resize tooltip position and content.
   *
   * @private
   */
  setupTooltipPosition() {
    const handleWidth = parseInt(outerWidth(this.handle), 10);
    const handleRightPosition = parseInt(this.handle.style.left, 10) + handleWidth;
    addClass(this.tooltip, 'active');

    this.tooltip.innerText = `高度: ${(this.newSize * 3 / 4).toFixed(2)} (${this.newSize} 像素)`;

    this.tooltip.style.top = this.handle.style.top;
    this.tooltip.style.left = `${handleRightPosition}px`;
    this.hot.rootElement.appendChild(this.tooltip);
  }

  /**
   * Refresh the resize tooltip position and content.
   *
   * @private
   */
  refreshTooltipPosition() {
    this.tooltip.innerText = `高度: ${(this.newSize * 3 / 4).toFixed(2)} (${this.newSize} 像素)`;
    this.tooltip.style.top = this.handle.style.top;
  }

  /**
   * Hides both the resize handle and resize guide.
   *
   * @private
   */
  hideHandleAndGuide() {
    removeClass(this.handle, 'active');
    removeClass(this.guide, 'active');
    removeClass(this.tooltip, 'active');
  }

  /**
   * Checks if provided element is considered as a row header.
   *
   * @private
   * @param {HTMLElement} element HTML element.
   * @returns {Boolean}
   */
  checkIfRowHeader(element) {
    if (element !== this.hot.rootElement) {
      const parent = element.parentNode;

      if (parent.tagName === 'TBODY') {
        return true;
      }

      return this.checkIfRowHeader(parent);
    }

    return false;
  }

  /**
   * Gets the TH element from the provided element.
   *
   * @private
   * @param {HTMLElement} element HTML element.
   * @returns {HTMLElement}
   */
  getTHFromTargetElement(element) {
    if (element.tagName !== 'TABLE') {
      if (element.tagName === 'TH') {
        return element;
      }
      return this.getTHFromTargetElement(element.parentNode);

    }

    return null;
  }

  /**
   * 'mouseover' event callback - set the handle position.
   *
   * @private
   * @param {MouseEvent} event
   */
  onMouseOver(event) {
    if (!this.pressed) {
      let th;

      if (this.checkIfRowHeader(event.target)) {
        th = this.getTHFromTargetElement(event.target);

      } else if (hasClass(event.target, 'manualRowResizer')) {
        const prevTH = this.hot.view.wt.wtTable.getRowHeader(this.currentRow - 1);
        const nextTH = this.hot.view.wt.wtTable.getRowHeader(this.currentRow + 1);

        if (prevTH && prevTH.getBoundingClientRect().bottom > event.clientY) {
          th = prevTH;
        } else if (nextTH && nextTH.getBoundingClientRect().top < event.clientY) {
          th = nextTH;
        }
      }

      if (th) {
        this.setupHandlePosition(th, event);
      }
    }
  }

  /**
   * Auto-size row after doubleclick - callback.
   *
   * @private
   * @fires Hooks#beforeRowResize
   * @fires Hooks#afterRowResize
   */
  afterMouseDownTimeout() {
    const render = () => {
      this.hot.forceFullRender = true;
      this.hot.view.render(); // updates all
      this.hot.view.wt.wtOverlays.adjustElementsSize(true);
    };
    const resize = (selectedRow, forceRender) => {
      const hookNewSize = this.hot.runHooks('beforeRowResize', this.newSize, selectedRow, true);

      if (hookNewSize !== void 0) {
        this.newSize = hookNewSize;
      }

      this.setManualSize(this.newSize, selectedRow); // double click sets auto row size

      if (forceRender) {
        render();
      }

      this.hot.runHooks('afterRowResize', this.newSize, selectedRow, true);
    };

    if (this.dblclick >= 2) {
      const selectedRowsLength = this.selectedRows.length;

      if (selectedRowsLength > 1) {
        arrayEach(this.selectedRows, (selectedRow) => {
          resize(selectedRow);
        });
        render();
      } else {
        arrayEach(this.selectedRows, (selectedRow) => {
          resize(selectedRow, true);
        });
      }
    }
    this.dblclick = 0;
    this.autoresizeTimeout = null;
  }

  /**
   * 'mousedown' event callback.
   *
   * @private
   * @param {MouseEvent} event
   */
  onMouseDown(event) {
    if (hasClass(event.target, 'manualRowResizer')) {
      this.startY = pageY(event);
      this.newSize = this.startHeight;

      this.setupGuidePosition();
      this.setupTooltipPosition();
      this.pressed = this.hot;

      if (this.autoresizeTimeout === null) {
        this.autoresizeTimeout = setTimeout(() => this.afterMouseDownTimeout(), 500);

        this.hot._registerTimeout(this.autoresizeTimeout);
      }

      this.dblclick += 1;
    }
  }

  /**
   * 'mousemove' event callback - refresh the handle and guide positions, cache the new row height.
   *
   * @private
   * @param {MouseEvent} event
   */
  onMouseMove(event) {
    if (this.pressed) {
      this.currentHeight = this.startHeight + (pageY(event) - this.startY);

      arrayEach(this.selectedRows, (selectedRow) => {
        this.newSize = this.setManualSize(this.currentHeight, selectedRow);
      });

      this.refreshHandlePosition();
      this.refreshGuidePosition();
      this.refreshTooltipPosition();
    }
  }

  /**
   * 'mouseup' event callback - apply the row resizing.
   *
   * @private
   * @param {MouseEvent} event
   *
   * @fires Hooks#beforeRowResize
   * @fires Hooks#afterRowResize
   */
  onMouseUp(event) {
    const render = () => {
      this.hot.forceFullRender = true;
      this.hot.view.render(); // updates all
      this.hot.view.wt.wtOverlays.adjustElementsSize(true);
    };
    const runHooks = (selectedRow, forceRender) => {
      this.hot.runHooks('beforeRowResize', this.newSize, selectedRow);

      if (forceRender) {
        render();
      }

      this.saveManualRowHeights();

      this.hot.runHooks('afterRowResize', this.newSize, selectedRow, false);
    };
    if (this.pressed) {
      this.hideHandleAndGuide();
      this.pressed = false;

      if (this.newSize !== this.startHeight) {
        const selectedRowsLength = this.selectedRows.length;

        if (selectedRowsLength > 1) {
          arrayEach(this.selectedRows, (selectedRow) => {
            runHooks(selectedRow);
          });
          render();
        } else {
          arrayEach(this.selectedRows, (selectedRow) => {
            runHooks(selectedRow, true);
          });
        }
      }

      this.setupHandlePosition(this.currentTH, event);
    }
  }

  /**
   * Binds the mouse events.
   *
   * @private
   */
  bindEvents() {
    this.eventManager.addEventListener(this.hot.rootElement, 'mousemove', e => this.onMouseOver(e));
    this.eventManager.addEventListener(this.hot.rootElement, 'mousedown', e => this.onMouseDown(e));
    this.eventManager.addEventListener(window, 'mousemove', e => this.onMouseMove(e));
    this.eventManager.addEventListener(window, 'mouseup', e => this.onMouseUp(e));
  }

  /**
   * Sets the new height for specified row index.
   *
   * @param {Number} height Row height.
   * @param {Number} row Visual row index.
   * @returns {Number} Returns new height.
   *
   * @fires Hooks#modifyRow
   */
  setManualSize(height, row) {
    const newHeight = Math.max(height, 0);

    this.hot.runHooks('modifyRow', row);

    // this.manualRowHeights[physicalRow] = newHeight;

    return newHeight;
  }

  /**
   * Modifies the provided row height, based on the plugin settings.
   *
   * @private
   * @param {Number} height Row height.
   * @param {Number} row Visual row index.
   * @returns {Number}
   *
   * @fires Hooks#modifyRow
   */
  onModifyRowHeight(height, row) {
    if (this.enabled) {
      const autoRowSizePlugin = this.hot.getPlugin('autoRowSize');
      const autoRowHeightResult = autoRowSizePlugin ? autoRowSizePlugin.heights[row] : null;
      const physicalRow = this.hot.runHooks('modifyRow', row);
      const manualRowHeight = this.manualRowHeights[physicalRow];

      if (manualRowHeight !== void 0 && (manualRowHeight === autoRowHeightResult || manualRowHeight > (height || 0))) {
        return manualRowHeight;
      }
    }

    return height;
  }
}

registerPlugin('manualRowResize', ManualRowResize);

export default ManualRowResize;
