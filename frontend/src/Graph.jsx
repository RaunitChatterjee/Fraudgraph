import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

const short = (id) => (id.startsWith('CASH:') ? 'ATM' : id.slice(-5))

export function nodeColor(n) {
  if (n.status === 'frozen') return '#a371f7'
  if (n.role === 'victim') return '#2f81f7'
  if (n.role === 'cash') return '#d29922'
  if (n.role === 'boundary') return '#6e7681'
  const s = n.score || 0
  if (n.role === 'mule') return s >= 0.8 ? '#f85149' : s >= 0.5 ? '#db6d28' : '#d29922'
  return s >= 0.5 ? '#f85149' : '#8b949e'
}

export const LEGEND = [
  ['#2f81f7', 'Victim'], ['#f85149', 'High-suspicion account'], ['#db6d28', 'Moderate'],
  ['#d29922', 'Cash-out'], ['#6e7681', 'Legit hub / neighbour'], ['#a371f7', 'Frozen'],
]

/**
 * Force-directed transaction graph.
 * nodes: {id, role, score, status, hop?}   edges: {source, target, amount, loop?}
 * click = select, double-click = expand neighbourhood, drag to pin, wheel to zoom.
 */
export default function Graph({ nodes, edges, selectedId, onSelect, onExpand, height = 560 }) {
  const svgRef = useRef(null)
  const cb = useRef({})
  cb.current = { onSelect, onExpand }

  useEffect(() => {
    const el = svgRef.current
    const svg = d3.select(el)
    svg.selectAll('*').remove()
    const w = el.clientWidth || 900
    const h = height
    const root = svg.append('g')
    svg.call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', (e) => root.attr('transform', e.transform)))
      .on('dblclick.zoom', null)

    svg.append('defs').append('marker')
      .attr('id', 'arrow').attr('viewBox', '0 -4 8 8').attr('refX', 16).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', '#6e7681')

    const ns = nodes.map((n) => ({ ...n }))
    const ids = new Set(ns.map((n) => n.id))
    const es = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e }))
    const maxHop = Math.max(1, ...ns.map((n) => (n.hop ?? 0)))
    const hasHop = ns.some((n) => n.hop !== undefined && n.hop !== null)

    const sim = d3.forceSimulation(ns)
      .force('link', d3.forceLink(es).id((d) => d.id).distance(60).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-170))
      .force('collide', d3.forceCollide(15))
      .force('y', d3.forceY(h / 2).strength(0.05))
      .force('x', d3.forceX((d) => (hasHop && d.hop != null ? 70 + (d.hop / maxHop) * (w - 140) : w / 2))
        .strength((d) => (hasHop && d.hop != null ? 0.18 : 0.03)))

    const link = root.append('g').selectAll('line').data(es).join('line')
      .attr('stroke', (d) => (d.loop ? '#f85149' : '#6e7681'))
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', (d) => 0.8 + Math.min(3, Math.log10(Math.max(10, d.amount || 10)) - 2))
      .attr('marker-end', 'url(#arrow)')

    const node = root.append('g').selectAll('g').data(ns).join('g')
      .attr('class', 'node').style('cursor', 'pointer')
      .on('click', (_, d) => cb.current.onSelect?.(d.id))
      .on('dblclick', (_, d) => cb.current.onExpand?.(d.id))
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
        .on('end', (e) => { if (!e.active) sim.alphaTarget(0) }))

    node.append('circle').attr('class', 'dot')
      .attr('r', (d) => (d.role === 'victim' ? 11 : d.role === 'cash' ? 7 : 9))
      .attr('fill', nodeColor).attr('stroke', '#0d1117').attr('stroke-width', 1.5)
    node.append('text').text((d) => short(d.id))
      .attr('dy', 22).attr('text-anchor', 'middle').attr('font-size', 9)
      .attr('fill', 'currentColor').attr('opacity', 0.75)
    node.append('title').text((d) => `${d.label || d.id}${d.score != null ? `\nscore ${Number(d.score).toFixed(2)}` : ''}`)

    sim.on('tick', () => {
      link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y)
      node.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })
    return () => sim.stop()
  }, [nodes, edges, height])

  useEffect(() => {
    d3.select(svgRef.current).selectAll('g.node circle.dot')
      .attr('stroke', (d) => (d.id === selectedId ? '#ffffff' : '#0d1117'))
      .attr('stroke-width', (d) => (d.id === selectedId ? 3 : 1.5))
  }, [selectedId, nodes, edges])

  return <svg ref={svgRef} width="100%" height={height} className="block text-ink bg-bg/60 rounded-b-md"
              role="img" aria-label="Transaction network graph" />
}
