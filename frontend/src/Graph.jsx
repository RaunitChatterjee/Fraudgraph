import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { Icon } from './lib.jsx'

const short = (id) => (id.startsWith('CASH:') ? 'ATM' : id.slice(-6))

export function nodeColor(n) {
  if (n.status === 'frozen') return '#2f8a86'
  if (n.role === 'victim') return 'currentColor'
  if (n.role === 'cash') return '#d98e04'
  if (n.role === 'boundary') return '#8a8174'
  const s = n.score || 0
  if (n.role === 'mule') return s >= 0.8 ? '#c8372d' : s >= 0.5 ? '#d9741c' : '#c99a14'
  return s >= 0.5 ? '#c8372d' : '#a89f8e'
}

export const LEGEND = [
  ['rgb(var(--ink))', 'Victim'], ['#c8372d', 'High suspicion'], ['#d9741c', 'Moderate'],
  ['#d98e04', 'Cash-out'], ['#a89f8e', 'Neighbour / hub'], ['#2f8a86', 'Sealed (frozen)'],
]

const compact = (v) => (v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : `${Math.round(v)}`)

/**
 * Force-directed transaction graph with toolbar (fit, layout, amount labels).
 * nodes: {id, role, score, status, hop?, inflow?}   edges: {source, target, amount, loop?}
 * click = select, double-click = expand neighbourhood, drag = pin, wheel = zoom.
 */
export default function Graph({ nodes, edges, selectedId, onSelect, onExpand, height = 520 }) {
  const svgRef = useRef(null)
  const zoomRef = useRef(null)
  const rootRef = useRef(null)
  const cb = useRef({})
  cb.current = { onSelect, onExpand }
  const [layout, setLayout] = useState('hop')
  const [amounts, setAmounts] = useState(false)

  const fit = (animate = true) => {
    const el = svgRef.current, root = rootRef.current
    if (!el || !root || !zoomRef.current) return
    const box = root.node().getBBox()
    if (!box.width || !box.height) return
    const w = el.clientWidth || 900
    const k = Math.min(1.4, 0.88 * Math.min(w / box.width, height / box.height))
    const tx = w / 2 - k * (box.x + box.width / 2), ty = height / 2 - k * (box.y + box.height / 2)
    const sel = animate ? d3.select(el).transition().duration(350) : d3.select(el)
    sel.call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(k))
  }

  useEffect(() => {
    const el = svgRef.current
    const svg = d3.select(el)
    svg.selectAll('*').remove()
    const w = el.clientWidth || 900
    const h = height
    const root = svg.append('g')
    rootRef.current = root
    const zoom = d3.zoom().scaleExtent([0.15, 4]).on('zoom', (e) => root.attr('transform', e.transform))
    zoomRef.current = zoom
    svg.call(zoom).on('dblclick.zoom', null)

    svg.append('defs').append('marker')
      .attr('id', 'arrow').attr('viewBox', '0 -4 8 8').attr('refX', 17).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', 'currentColor').attr('fill-opacity', 0.55)

    const ns = nodes.map((n) => ({ ...n }))
    const ids = new Set(ns.map((n) => n.id))
    const es = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e }))
    const maxHop = Math.max(1, ...ns.map((n) => n.hop ?? 0))
    const hopLayout = layout === 'hop' && ns.some((n) => n.hop != null)
    const radius = (d) => (d.role === 'victim' ? 12 : d.role === 'cash' ? 7 : 7 + Math.min(7, Math.max(0, Math.log10((d.inflow || 1)) - 3) * 3))

    const sim = d3.forceSimulation(ns)
      .force('link', d3.forceLink(es).id((d) => d.id).distance(hopLayout ? 52 : 70).strength(0.5))
      .force('charge', d3.forceManyBody().strength(hopLayout ? -150 : -210))
      .force('collide', d3.forceCollide((d) => radius(d) + 5))
      .force('y', d3.forceY(h / 2).strength(hopLayout ? 0.06 : 0.04))
      .force('x', d3.forceX((d) => (hopLayout && d.hop != null ? 80 + (d.hop / maxHop) * (w - 160) : w / 2))
        .strength((d) => (hopLayout && d.hop != null ? 0.22 : 0.04)))

    const link = root.append('g').selectAll('line').data(es).join('line')
      .attr('stroke', (d) => (d.loop ? '#c8372d' : 'currentColor'))
      .attr('stroke-opacity', (d) => (d.loop ? 0.8 : 0.4))
      .attr('stroke-width', (d) => 0.8 + Math.min(3, Math.log10(Math.max(10, d.amount || 10)) - 2))
      .attr('marker-end', 'url(#arrow)')
    link.append('title').text((d) => `₹${Math.round(d.amount || 0).toLocaleString('en-IN')}${d.loop ? ' (loop)' : ''}`)

    const elabel = root.append('g').selectAll('text').data(amounts ? es : []).join('text')
      .attr('font-size', 9).attr('text-anchor', 'middle').attr('fill', 'currentColor').attr('fill-opacity', 0.7)
      .text((d) => compact(d.amount || 0))

    const node = root.append('g').selectAll('g').data(ns).join('g')
      .attr('class', 'node').style('cursor', 'pointer')
      .on('click', (_, d) => cb.current.onSelect?.(d.id))
      .on('dblclick', (_, d) => cb.current.onExpand?.(d.id))
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
        .on('end', (e) => { if (!e.active) sim.alphaTarget(0) }))

    node.append('circle').attr('class', 'dot').attr('r', radius).attr('fill', nodeColor)
      .style('stroke', 'rgb(var(--panel))').attr('stroke-width', 2)
    node.append('text').text((d) => short(d.id))
      .attr('dy', (d) => radius(d) + 11).attr('text-anchor', 'middle').attr('font-size', 9)
      .attr('class', 'mono').attr('fill', 'currentColor').attr('fill-opacity', 0.72)
    node.append('title').text((d) => `${d.label || d.id}${d.score != null ? `\nsuspicion ${Number(d.score).toFixed(2)}` : ''}`)

    sim.on('tick', () => {
      link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y)
      elabel.attr('x', (d) => (d.source.x + d.target.x) / 2).attr('y', (d) => (d.source.y + d.target.y) / 2 - 3)
      node.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })
    sim.on('end', () => fit(false))
    const t = setTimeout(() => fit(true), 700)
    return () => { sim.stop(); clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, height, layout, amounts])

  useEffect(() => {
    d3.select(svgRef.current).selectAll('g.node circle.dot')
      .style('stroke', (d) => (d.id === selectedId ? 'rgb(var(--accent))' : 'rgb(var(--panel))'))
      .attr('stroke-width', (d) => (d.id === selectedId ? 3.5 : 2))
  }, [selectedId, nodes, edges, layout, amounts])

  const tb = 'flex items-center gap-1 rounded border border-line bg-panel/95 px-2 py-1 text-xs hover:border-accent'
  return (
    <div className="relative">
      <svg ref={svgRef} width="100%" height={height} className="graphpaper block text-ink" role="img" aria-label="Transaction network graph" />
      <div className="absolute right-3 top-3 flex gap-1.5">
        <button className={tb} onClick={() => fit(true)} title="Fit graph to view"><Icon name="expand" size={13} />Fit</button>
        <button className={tb} onClick={() => setLayout(layout === 'hop' ? 'free' : 'hop')} title="Toggle layout">
          {layout === 'hop' ? 'Layout: by hop' : 'Layout: free'}
        </button>
        <button className={`${tb} ${amounts ? 'border-accent text-accent' : ''}`} onClick={() => setAmounts(!amounts)}>₹ labels</button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-sm border border-line bg-panel/90 px-2.5 py-1.5 text-[11px]">
        {LEGEND.map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</span>)}
      </div>
    </div>
  )
}
