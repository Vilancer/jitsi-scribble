// <ScribbleToolbar>: the drawing palette (tools, shapes, colours, size,
// clear, done) in the style of iOS Markup / FaceTime's drawing tools. Reads
// and writes the surrounding <ScribbleProvider>'s tool state. The Android
// out-of-app overlay draws the same palette natively.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Circle, G, Line, Path, Polyline, Rect, Svg } from 'react-native-svg';

import {
  colourGrid,
  SCRIBBLE_COLOURS,
  SCRIBBLE_SHAPES,
  SCRIBBLE_TOOLS,
  SCRIBBLE_WIDTHS,
  type ScribbleShape,
  type ScribbleTool,
} from '@vilancer/protocol/render';

import { useScribble } from './ScribbleProvider.js';

export interface ScribbleToolbarProps {
  /** Called after the done button turns draw mode off. */
  onDone?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Override the colour swatches (defaults to SCRIBBLE_COLOURS). */
  colours?: readonly string[];
}

const PANEL = '#1C1C1EF2';
const BODY = '#F2F2F7';
const SHADE = '#C7C7CC';

function ToolNib({ tool, tint }: { tool: ScribbleTool; tint: string }) {
  // 28x64 box, tip at the top, body running off the bottom edge.
  switch (tool) {
    case 'pen':
      return (
        <G>
          <Rect x={5} y={22} width={18} height={50} rx={3} fill={BODY} />
          <Rect x={19} y={22} width={4} height={50} fill={SHADE} />
          <Path d="M5 22 L14 4 L23 22 Z" fill={SHADE} />
          <Path d="M11 10 L14 4 L17 10 Z" fill={tint} />
          <Rect x={5} y={30} width={18} height={4} fill={tint} />
        </G>
      );
    case 'marker':
      return (
        <G>
          <Rect x={3} y={22} width={22} height={50} rx={3} fill={BODY} />
          <Rect x={21} y={22} width={4} height={50} fill={SHADE} />
          <Path d="M6 22 L7 12 L21 7 L22 22 Z" fill={tint} />
          <Rect x={3} y={30} width={22} height={4} fill={tint} />
        </G>
      );
    case 'pencil':
      return (
        <G>
          <Rect x={5} y={22} width={18} height={50} rx={2} fill={BODY} />
          <Rect x={19} y={22} width={4} height={50} fill={SHADE} />
          <Path d="M5 22 L14 3 L23 22 Z" fill="#E9C79A" />
          <Path d="M10.5 10.5 L14 3 L17.5 10.5 Z" fill={tint} />
        </G>
      );
    default:
      return (
        <G>
          <Rect x={3} y={22} width={22} height={50} rx={3} fill={BODY} />
          <Rect x={4.5} y={26} width={19} height={18} rx={2} fill={tint} />
          <Path d="M4 23 Q4 8 14 8 Q24 8 24 23 Z" fill={tint} />
        </G>
      );
  }
}

function ShapeGlyph({ shape, color }: { shape: ScribbleShape; color: string }) {
  const p = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (shape) {
    case 'line':
      return <Line x1={4} y1={20} x2={20} y2={4} {...p} />;
    case 'arrow':
      return (
        <G>
          <Line x1={4} y1={20} x2={20} y2={4} {...p} />
          <Polyline points="11,4 20,4 20,13" {...p} />
        </G>
      );
    case 'rect':
      return <Rect x={3} y={6} width={18} height={12} rx={2} {...p} />;
    default:
      return <Circle cx={12} cy={12} r={9} {...p} />;
  }
}

const SPECTRUM = ['#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#64D2FF', '#0A84FF', '#BF5AF2', '#FF375F'];

function SpectrumSwatch() {
  const r = 11;
  const segs = SPECTRUM.length;
  return (
    <Svg width={30} height={30} viewBox="0 0 30 30">
      {SPECTRUM.map((c, i) => {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const d = `M15 15 L${15 + r * Math.cos(a0)} ${15 + r * Math.sin(a0)} A${r} ${r} 0 0 1 ${15 + r * Math.cos(a1)} ${15 + r * Math.sin(a1)} Z`;
        return <Path key={c} d={d} fill={c} />;
      })}
    </Svg>
  );
}

export function ScribbleToolbar({ onDone, style, colours = SCRIBBLE_COLOURS }: ScribbleToolbarProps) {
  const { tools, setTools, setDrawing, clearMine } = useScribble();
  const [gridOpen, setGridOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const grid = useMemo(() => colourGrid(), []);
  const custom = !colours.some((c) => c.toUpperCase() === tools.color.toUpperCase());

  return (
    <View style={[styles.panel, style]} testID="scribble-toolbar">
      {sizeOpen ? (
        <View style={styles.rowA} testID="scribble-toolbar-sizes">
          {SCRIBBLE_WIDTHS.map((w) => (
            <Pressable
              key={w}
              testID={`scribble-size-${w}`}
              accessibilityLabel={`size ${w}`}
              accessibilityState={{ selected: tools.width === w }}
              onPress={() => {
                setTools({ width: w });
                setSizeOpen(false);
              }}
              style={styles.shapeSlot}
            >
              <View style={[styles.shapeBg, tools.width === w && styles.shapeBgSelected]}>
                <View
                  style={{
                    width: 1.2 + w * 1.1,
                    height: 1.2 + w * 1.1,
                    borderRadius: 20,
                    backgroundColor: tools.color === '#000000' ? '#FFFFFF' : tools.color,
                  }}
                />
              </View>
            </Pressable>
          ))}
        </View>
      ) : gridOpen ? (
        <View style={styles.grid} testID="scribble-toolbar-grid">
          {grid.map((row, ri) => (
            <View key={ri} style={styles.gridRow}>
              {row.map((c) => (
                <Pressable
                  key={c + ri}
                  accessibilityLabel={`colour ${c}`}
                  onPress={() => {
                    setTools({ color: c });
                    setGridOpen(false);
                  }}
                  style={[styles.cell, { backgroundColor: c }, c === tools.color && styles.cellSelected]}
                />
              ))}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.rowA}>
          {SCRIBBLE_TOOLS.map((t) => {
            const selected = tools.shape === null && tools.tool === t;
            return (
              <Pressable
                key={t}
                testID={`scribble-tool-${t}`}
                accessibilityLabel={t}
                accessibilityState={{ selected }}
                onPress={() => setTools({ tool: t, shape: null })}
                style={styles.toolSlot}
              >
                <Svg width={28} height={64} viewBox="0 0 28 64" style={{ transform: [{ translateY: selected ? 0 : 14 }] }}>
                  <ToolNib tool={t} tint={tools.color} />
                </Svg>
              </Pressable>
            );
          })}
          <View style={styles.vDivider} />
          {SCRIBBLE_SHAPES.map((s) => {
            const selected = tools.shape === s;
            return (
              <Pressable
                key={s}
                testID={`scribble-shape-${s}`}
                accessibilityLabel={s}
                accessibilityState={{ selected }}
                onPress={() => setTools({ shape: s })}
                style={styles.shapeSlot}
              >
                <View style={[styles.shapeBg, selected && styles.shapeBgSelected]}>
                  <Svg width={24} height={24} viewBox="0 0 24 24">
                    <ShapeGlyph shape={s} color={selected && tools.color !== '#000000' ? tools.color : '#FFFFFF'} />
                  </Svg>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={styles.hDivider} />
      <View style={styles.rowB}>
        {colours.map((c) => (
          <Pressable
            key={c}
            testID={`scribble-colour-${c}`}
            accessibilityLabel={`colour ${c}`}
            accessibilityState={{ selected: c.toUpperCase() === tools.color.toUpperCase() }}
            onPress={() => setTools({ color: c })}
            style={styles.swatchSlot}
          >
            <View style={[styles.ring, c.toUpperCase() === tools.color.toUpperCase() && styles.ringOn]}>
              <View style={[styles.swatch, { backgroundColor: c }, c === '#000000' && styles.swatchDark]} />
            </View>
          </Pressable>
        ))}
        <Pressable
          testID="scribble-more-colours"
          accessibilityLabel="more colours"
          onPress={() => {
            setSizeOpen(false);
            setGridOpen((v) => !v);
          }}
          style={styles.swatchSlot}
        >
          <View style={[styles.ring, (gridOpen || custom) && styles.ringOn]}>
            {custom ? <View style={[styles.swatch, { backgroundColor: tools.color }]} /> : <SpectrumSwatch />}
          </View>
        </Pressable>
        <Pressable
          testID="scribble-size"
          accessibilityLabel={`size ${tools.width}`}
          onPress={() => {
            setGridOpen(false);
            setSizeOpen((v) => !v);
          }}
          style={styles.swatchSlot}
        >
          <Svg width={30} height={30} viewBox="0 0 30 30">
            <Circle cx={15} cy={15} r={13} stroke="#FFFFFF66" strokeWidth={1.5} fill="none" />
            <Circle cx={15} cy={15} r={Math.min(1.2 + tools.width * 0.55, 11)} fill="#FFFFFF" />
          </Svg>
        </Pressable>
        <Pressable testID="scribble-clear" accessibilityLabel="clear my drawing" onPress={clearMine} style={styles.swatchSlot}>
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <G stroke="#FFFFFF" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <Line x1={4} y1={6} x2={20} y2={6} />
              <Line x1={9} y1={3} x2={15} y2={3} />
              <Path d="M6 6 L7 21 L17 21 L18 6" />
              <Line x1={10} y1={10} x2={10} y2={17} />
              <Line x1={14} y1={10} x2={14} y2={17} />
            </G>
          </Svg>
        </Pressable>
        <Pressable
          testID="scribble-done"
          accessibilityLabel="done"
          onPress={() => {
            setDrawing(false);
            onDone?.();
          }}
          style={styles.swatchSlot}
        >
          <View style={styles.doneBg}>
            <Svg width={14} height={14} viewBox="0 0 14 14">
              <G stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round">
                <Line x1={2} y1={2} x2={12} y2={12} />
                <Line x1={12} y1={2} x2={2} y2={12} />
              </G>
            </Svg>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: PANEL,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FFFFFF33',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
    alignSelf: 'center',
    maxWidth: 400,
    width: '94%',
    overflow: 'hidden',
  },
  rowA: { flexDirection: 'row', alignItems: 'flex-end', height: 70, overflow: 'hidden' },
  toolSlot: { flex: 1, alignItems: 'center', height: 70, justifyContent: 'flex-end' },
  shapeSlot: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 70 },
  shapeBg: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  shapeBgSelected: { backgroundColor: '#3A3A3C' },
  vDivider: { width: StyleSheet.hairlineWidth, backgroundColor: '#FFFFFF33', height: 44, marginHorizontal: 6, alignSelf: 'center' },
  hDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#FFFFFF33' },
  rowB: { flexDirection: 'row', alignItems: 'center', height: 52 },
  swatchSlot: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 52 },
  ring: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  ringOn: { borderColor: '#FFFFFF' },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  swatchDark: { borderWidth: 1, borderColor: '#FFFFFF55' },
  doneBg: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#3A3A3C', alignItems: 'center', justifyContent: 'center' },
  grid: { paddingVertical: 4 },
  gridRow: { flexDirection: 'row' },
  cell: { flex: 1, aspectRatio: 1, margin: 1, borderRadius: 3 },
  cellSelected: { borderWidth: 2, borderColor: '#FFFFFF' },
});
