import { Canvas as FabricCanvas, Line, FabricObject } from 'fabric';

interface AlignmentGuide {
    orientation: 'horizontal' | 'vertical';
    position: number; // px from left (vertical) or top (horizontal)
    visible: boolean;
}

interface SnapResult {
    snapped: boolean;
    x?: number;
    y?: number;
}

const SNAP_THRESHOLD = 8; // pixels
const GUIDE_COLOR = '#FF1493'; // Canva-style pink/magenta
const GUIDE_WIDTH = 1;

/**
 * SmartGuides - Provides Canva-like alignment guides and snapping
 */
export class SmartGuides {
    private canvas: FabricCanvas;
    private canvasWidth: number;
    private canvasHeight: number;
    private guides: Line[] = [];
    private enabled: boolean = true;

    constructor(canvas: FabricCanvas, width: number, height: number) {
        this.canvas = canvas;
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.createGuideLines();
    }

    /**
     * Update canvas dimensions
     */
    updateDimensions(width: number, height: number) {
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.removeGuideLines();
        this.createGuideLines();
    }

    /**
     * Enable/disable smart guides
     */
    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        if (!enabled) {
            this.hideAllGuides();
        }
    }

    /**
     * Create reusable guide lines (hidden by default)
     */
    private createGuideLines() {
        // Vertical center guide
        const vCenter = new Line([this.canvasWidth / 2, 0, this.canvasWidth / 2, this.canvasHeight], {
            stroke: GUIDE_COLOR,
            strokeWidth: GUIDE_WIDTH,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
            visible: false,
            excludeFromExport: true,
        });

        // Horizontal center guide
        const hCenter = new Line([0, this.canvasHeight / 2, this.canvasWidth, this.canvasHeight / 2], {
            stroke: GUIDE_COLOR,
            strokeWidth: GUIDE_WIDTH,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
            visible: false,
            excludeFromExport: true,
        });

        // Left edge guide
        const leftEdge = new Line([0, 0, 0, this.canvasHeight], {
            stroke: GUIDE_COLOR,
            strokeWidth: GUIDE_WIDTH,
            selectable: false,
            evented: false,
            visible: false,
            excludeFromExport: true,
        });

        // Right edge guide
        const rightEdge = new Line([this.canvasWidth, 0, this.canvasWidth, this.canvasHeight], {
            stroke: GUIDE_COLOR,
            strokeWidth: GUIDE_WIDTH,
            selectable: false,
            evented: false,
            visible: false,
            excludeFromExport: true,
        });

        // Top edge guide
        const topEdge = new Line([0, 0, this.canvasWidth, 0], {
            stroke: GUIDE_COLOR,
            strokeWidth: GUIDE_WIDTH,
            selectable: false,
            evented: false,
            visible: false,
            excludeFromExport: true,
        });

        // Bottom edge guide
        const bottomEdge = new Line([0, this.canvasHeight, this.canvasWidth, this.canvasHeight], {
            stroke: GUIDE_COLOR,
            strokeWidth: GUIDE_WIDTH,
            selectable: false,
            evented: false,
            visible: false,
            excludeFromExport: true,
        });

        this.guides = [vCenter, hCenter, leftEdge, rightEdge, topEdge, bottomEdge];
        this.guides.forEach((guide) => this.canvas.add(guide));
    }

    /**
     * Remove guide lines from canvas
     */
    private removeGuideLines() {
        this.guides.forEach((guide) => this.canvas.remove(guide));
        this.guides = [];
    }

    /**
     * Hide all guides
     */
    hideAllGuides() {
        this.guides.forEach((guide) => {
            guide.set('visible', false);
        });
        this.canvas.requestRenderAll();
    }

    /**
     * Calculate snap positions and show guides during dragging
     */
    handleObjectMoving(obj: FabricObject): SnapResult {
        if (!this.enabled) return { snapped: false };

        const objLeft = obj.left || 0;
        const objTop = obj.top || 0;
        const objWidth = (obj.width || 0) * (obj.scaleX || 1);
        const objHeight = (obj.height || 0) * (obj.scaleY || 1);

        // Object bounds
        const objCenterX = objLeft + objWidth / 2;
        const objCenterY = objTop + objHeight / 2;
        const objRight = objLeft + objWidth;
        const objBottom = objTop + objHeight;

        let snapX: number | undefined;
        let snapY: number | undefined;

        // Canvas snap points
        const canvasCenterX = this.canvasWidth / 2;
        const canvasCenterY = this.canvasHeight / 2;

        // Reset all guides
        this.guides.forEach((g) => g.set('visible', false));

        // Check vertical center alignment (object center with canvas center)
        if (Math.abs(objCenterX - canvasCenterX) < SNAP_THRESHOLD) {
            snapX = canvasCenterX - objWidth / 2;
            this.guides[0].set('visible', true); // vCenter
        }

        // Check horizontal center alignment (object center with canvas center)
        if (Math.abs(objCenterY - canvasCenterY) < SNAP_THRESHOLD) {
            snapY = canvasCenterY - objHeight / 2;
            this.guides[1].set('visible', true); // hCenter
        }

        // Check left edge
        if (Math.abs(objLeft) < SNAP_THRESHOLD) {
            snapX = 0;
            this.guides[2].set('visible', true); // leftEdge
        }

        // Check right edge
        if (Math.abs(objRight - this.canvasWidth) < SNAP_THRESHOLD) {
            snapX = this.canvasWidth - objWidth;
            this.guides[3].set('visible', true); // rightEdge
        }

        // Check top edge
        if (Math.abs(objTop) < SNAP_THRESHOLD) {
            snapY = 0;
            this.guides[4].set('visible', true); // topEdge
        }

        // Check bottom edge
        if (Math.abs(objBottom - this.canvasHeight) < SNAP_THRESHOLD) {
            snapY = this.canvasHeight - objHeight;
            this.guides[5].set('visible', true); // bottomEdge
        }

        // Also check alignment with other objects
        const otherObjects = this.canvas.getObjects().filter(
            (o) => o !== obj && !this.guides.includes(o as Line) && o.selectable !== false
        );

        for (const other of otherObjects) {
            const otherLeft = other.left || 0;
            const otherTop = other.top || 0;
            const otherWidth = (other.width || 0) * (other.scaleX || 1);
            const otherHeight = (other.height || 0) * (other.scaleY || 1);
            const otherCenterX = otherLeft + otherWidth / 2;
            const otherCenterY = otherTop + otherHeight / 2;
            const otherRight = otherLeft + otherWidth;
            const otherBottom = otherTop + otherHeight;

            // Center-to-center horizontal
            if (Math.abs(objCenterX - otherCenterX) < SNAP_THRESHOLD) {
                snapX = otherCenterX - objWidth / 2;
                this.showDynamicGuide('vertical', otherCenterX);
            }

            // Center-to-center vertical
            if (Math.abs(objCenterY - otherCenterY) < SNAP_THRESHOLD) {
                snapY = otherCenterY - objHeight / 2;
                this.showDynamicGuide('horizontal', otherCenterY);
            }

            // Left edge to left edge
            if (Math.abs(objLeft - otherLeft) < SNAP_THRESHOLD) {
                snapX = otherLeft;
                this.showDynamicGuide('vertical', otherLeft);
            }

            // Right edge to right edge
            if (Math.abs(objRight - otherRight) < SNAP_THRESHOLD) {
                snapX = otherRight - objWidth;
                this.showDynamicGuide('vertical', otherRight);
            }

            // Left edge to right edge
            if (Math.abs(objLeft - otherRight) < SNAP_THRESHOLD) {
                snapX = otherRight;
                this.showDynamicGuide('vertical', otherRight);
            }

            // Right edge to left edge
            if (Math.abs(objRight - otherLeft) < SNAP_THRESHOLD) {
                snapX = otherLeft - objWidth;
                this.showDynamicGuide('vertical', otherLeft);
            }

            // Top edge to top edge
            if (Math.abs(objTop - otherTop) < SNAP_THRESHOLD) {
                snapY = otherTop;
                this.showDynamicGuide('horizontal', otherTop);
            }

            // Bottom edge to bottom edge
            if (Math.abs(objBottom - otherBottom) < SNAP_THRESHOLD) {
                snapY = otherBottom - objHeight;
                this.showDynamicGuide('horizontal', otherBottom);
            }

            // Top to bottom
            if (Math.abs(objTop - otherBottom) < SNAP_THRESHOLD) {
                snapY = otherBottom;
                this.showDynamicGuide('horizontal', otherBottom);
            }

            // Bottom to top
            if (Math.abs(objBottom - otherTop) < SNAP_THRESHOLD) {
                snapY = otherTop - objHeight;
                this.showDynamicGuide('horizontal', otherTop);
            }
        }

        this.canvas.requestRenderAll();

        return {
            snapped: snapX !== undefined || snapY !== undefined,
            x: snapX,
            y: snapY,
        };
    }

    /**
     * Show a dynamic guide line at a specific position
     */
    private dynamicGuides: Line[] = [];

    private showDynamicGuide(orientation: 'horizontal' | 'vertical', position: number) {
        const line = orientation === 'vertical'
            ? new Line([position, 0, position, this.canvasHeight], {
                stroke: GUIDE_COLOR,
                strokeWidth: GUIDE_WIDTH,
                selectable: false,
                evented: false,
                excludeFromExport: true,
            })
            : new Line([0, position, this.canvasWidth, position], {
                stroke: GUIDE_COLOR,
                strokeWidth: GUIDE_WIDTH,
                selectable: false,
                evented: false,
                excludeFromExport: true,
            });

        this.dynamicGuides.push(line);
        this.canvas.add(line);
    }

    /**
     * Clear dynamic guides (call on object:modified or selection:cleared)
     */
    clearDynamicGuides() {
        this.dynamicGuides.forEach((guide) => this.canvas.remove(guide));
        this.dynamicGuides = [];
        this.hideAllGuides();
    }

    /**
     * Dispose of all guides
     */
    dispose() {
        this.removeGuideLines();
        this.clearDynamicGuides();
    }
}
