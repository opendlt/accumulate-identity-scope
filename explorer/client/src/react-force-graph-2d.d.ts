declare module 'react-force-graph-2d' {
  import { Component } from 'react';

  interface NodeObject {
    id?: string | number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number;
    fy?: number;
    [key: string]: any;
  }

  interface LinkObject {
    source?: string | number | NodeObject;
    target?: string | number | NodeObject;
    [key: string]: any;
  }

  interface ForceGraphProps {
    graphData?: { nodes: NodeObject[]; links: LinkObject[] };
    width?: number;
    height?: number;
    backgroundColor?: string;
    nodeRelSize?: number;
    nodeVal?: number | string | ((node: NodeObject) => number);
    nodeLabel?: string | ((node: NodeObject) => string);
    nodeColor?: string | ((node: NodeObject) => string);
    nodeCanvasObject?: (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => void;
    nodeCanvasObjectMode?: string | ((node: NodeObject) => string);
    linkColor?: string | ((link: LinkObject) => string);
    linkWidth?: number | ((link: LinkObject) => number);
    linkLineDash?: number[] | ((link: LinkObject) => number[]);
    linkDirectionalArrowLength?: number | ((link: LinkObject) => number);
    linkDirectionalArrowColor?: string | ((link: LinkObject) => string);
    linkCurvature?: number | ((link: LinkObject) => number);
    linkCanvasObject?: (link: LinkObject, ctx: CanvasRenderingContext2D, globalScale: number) => void;
    linkCanvasObjectMode?: string | ((link: LinkObject) => string);
    onNodeClick?: (node: NodeObject, event: MouseEvent) => void;
    onNodeHover?: (node: NodeObject | null, prevNode: NodeObject | null) => void;
    onLinkClick?: (link: LinkObject, event: MouseEvent) => void;
    onLinkHover?: (link: LinkObject | null, prevLink: LinkObject | null) => void;
    onBackgroundClick?: (event: MouseEvent) => void;
    cooldownTicks?: number;
    cooldownTime?: number;
    warmupTicks?: number;
    d3AlphaDecay?: number;
    d3VelocityDecay?: number;
    d3AlphaMin?: number;
    dagMode?: string;
    dagLevelDistance?: number;
    enableNodeDrag?: boolean;
    enableZoomInteraction?: boolean;
    enablePanInteraction?: boolean;
    minZoom?: number;
    maxZoom?: number;
    onZoom?: (transform: { k: number; x: number; y: number }) => void;
    onZoomEnd?: (transform: { k: number; x: number; y: number }) => void;
    onEngineStop?: () => void;
    ref?: any;
    [key: string]: any;
  }

  export default class ForceGraph2D extends Component<ForceGraphProps> {
    zoom(k?: number, duration?: number): this;
    centerAt(x?: number, y?: number, duration?: number): this;
    d3Force(forceName: string, force?: any): any;
    d3ReheatSimulation(): this;
    emitParticle(link: LinkObject): this;
  }
}
