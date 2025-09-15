import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { auth, googleProvider } from '../firebase'
import { signInWithPopup, signOut, getIdToken } from 'firebase/auth'

// @ts-ignore
declare global { interface Window { google: any } }

type Rule = { field: 'totalSpend' | 'visits' | 'inactiveDays'; cmp: '>' | '<' | '>=' | '<=' | '=='; value: number }
type RulesNode = { op: 'AND' | 'OR'; rules: (Rule | RulesNode)[] }

type User = { id: string, email: string, name?: string|null }

const API = import.meta.env.VITE_API_BASE || 'http://localhost:8080'

function RuleRow({ rule, onChange, onDelete }: { rule: Rule, onChange: (r: Rule)=>void, onDelete: ()=>void }) {
  return (
    <div className="rule-row">
      <select className="select" value={rule.field} onChange={e => onChange({ ...rule, field: e.target.value as any })}>
        <option value="totalSpend">totalSpend</option>
        <option value="visits">visits</option>
        <option value="inactiveDays">inactiveDays</option>
      </select>
      <select className="select" value={rule.cmp} onChange={e => onChange({ ...rule, cmp: e.target.value as any })}>
        <option value=">">&gt;</option>
        <option value="<">&lt;</option>
        <option value=">=">&gt;=</option>
        <option value="<=">&lt;=</option>
        <option value="==">==</option>
      </select>
      <input className="input" type="number" value={rule.value} onChange={e => onChange({ ...rule, value: Number(e.target.value) })} />
      <button className="button secondary" onClick={onDelete}>Delete</button>
    </div>
  )
}

export default function App() {
  const [rules, setRules] = useState<Rule[]>([{ field:'totalSpend', cmp:'>', value:10000 }])
  const [op, setOp] = useState<'AND'|'OR'>('AND')
  const [audience, setAudience] = useState<number|null>(null)
  const [name, setName] = useState('HVC Winback')
  const [msg, setMsg] = useState("here’s 10% off on your next order!")
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [user, setUser] = useState<User|null>(null)
  const [prompt, setPrompt] = useState('People who haven’t shopped in 6 months and spent over ₹5K')

  const rulesNode: RulesNode = useMemo(()=>({ op, rules }), [op, rules])

  useEffect(() => {
    const t = localStorage.getItem('jwt')
    if (t) axios.defaults.headers.common['Authorization'] = `Bearer ${t}`
    const u = localStorage.getItem('user')
    if (u) setUser(JSON.parse(u))
  }, [])

  const doLogin = async () => {
    try {
      const cred = await signInWithPopup(auth, googleProvider)
      const idToken = await getIdToken(cred.user, true)
      const { data } = await axios.post(`${API}/auth/firebase`, { idToken })
      localStorage.setItem('jwt', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
      setUser(data.user)
      setTimeout(() => document.getElementById('segment')?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (e:any) {
      // Surface errors to help debug sign-in issues
      const msg = e?.response?.data?.error || e?.message || 'Login failed'
      console.error('Login error:', e)
      alert(`Login failed: ${msg}`)
    }
  }

  const logout = async () => {
    await signOut(auth)
    localStorage.removeItem('jwt'); localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization']; setUser(null)
  }

  const preview = async () => {
    const { data } = await axios.post(`${API}/api/segments/preview`, { rules: rulesNode })
    setAudience(data.audienceSize)
  }

  const createCampaign = async () => {
    await axios.post(`${API}/api/segments`, { name, rules: rulesNode, messageTemplate: msg })
    await loadCampaigns()
  }

  const loadCampaigns = async () => {
    const { data } = await axios.get(`${API}/api/campaigns`)
    setCampaigns(data)
  }

  const [stats, setStats] = useState<any|null>(null)
  const [series, setSeries] = useState<any|null>(null)
  const loadStats = async () => {
    const { data } = await axios.get(`${API}/api/stats`)
    setStats(data)
  }
  const loadSeries = async () => {
    const { data } = await axios.get(`${API}/api/stats/series`)
    setSeries(data)
  }

  useEffect(() => { if (user) { loadStats(); loadSeries(); loadCampaigns(); } }, [user])

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('jwt')
    const es = new EventSource(`${API}/api/stats/stream?token=${encodeURIComponent(token||'')}`)
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data)
        if (payload.kpis) setStats(payload.kpis)
        if (payload.series) setSeries(payload.series)
      } catch {}
    }
    es.onerror = () => { es.close() }
    return () => { es.close() }
  }, [user])

  const generateFromPrompt = async () => {
    const { data } = await axios.post(`${API}/api/ai/nl-to-rules`, { prompt })
    const rn = data.rules as RulesNode
    const flat: Rule[] = []
    const flatten = (n: RulesNode | Rule) => { if ((n as any).op) (n as RulesNode).rules.forEach(flatten); else flat.push(n as Rule) }
    flatten(rn)
    setOp('AND'); setRules(flat)
  }

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <h1>Xeno Mini-CRM</h1>
        </div>
        {!user ? (
          <div className="toolbar">
            <button className="button" onClick={doLogin}>Sign in with Google</button>
          </div>
        ) : (
          <div className="toolbar">
            <span>Signed in as <b>{user.email}</b></span>
            <div className="avatar">{(user.email||'?')[0].toUpperCase()}</div>
            <button className="button secondary" onClick={logout}>Logout</button>
          </div>
        )}
      </div>

      {!user && (
        <div className="card" style={{ padding: 24, textAlign:'center', marginBottom:16 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>Build powerful segments. Send beautiful campaigns.</h2>
          <p style={{ color: 'var(--muted)', margin: '8px 0 16px' }}>Sign in to create audiences with rules or natural language, preview reach, and launch a campaign in seconds.</p>
          <button className="button" onClick={doLogin}>Sign in with Google</button>
        </div>
      )}

      {user && (
        <div className="shell">
          <div className="sidebar">
            <div className="nav">
              <a className="active" href="#">Dashboard</a>
              <a href="#segment">Segments</a>
              <a href="#campaigns">Campaigns</a>
            </div>
          </div>
          <div>
            <div className="kpis">
              <div className="tile kpi-tile"><div><div className="lbl">Customers</div><div className="num">{stats?.customers ?? '-'}</div></div><div className="lbl">total</div></div>
              <div className="tile kpi-tile"><div><div className="lbl">Orders</div><div className="num">{stats?.orders ?? '-'}</div></div><div className="lbl">total</div></div>
              <div className="tile kpi-tile"><div><div className="lbl">Campaigns</div><div className="num">{stats?.campaigns ?? '-'}</div></div><div className="lbl">created</div></div>
              <div className="tile kpi-tile"><div><div className="lbl">Delivered</div><div className="num">{stats?.sent ?? '-'}</div></div><div className="lbl">sent</div></div>
            </div>
            <div className="dashboard-grid" style={{ marginBottom:16 }}>
              <div className="tile span-3"><h4>Customers</h4><div className="kpi"><div className="big">{stats?.customers ?? '-'}</div><div className="sub">total</div></div></div>
              <div className="tile span-3"><h4>Orders</h4><div className="kpi"><div className="big">{stats?.orders ?? '-'}</div><div className="sub">total</div></div></div>
              <div className="tile span-3"><h4>Campaigns</h4><div className="kpi"><div className="big">{stats?.campaigns ?? '-'}</div><div className="sub">created</div></div></div>
              <div className="tile span-3"><h4>Delivered</h4><div className="kpi"><div className="big">{stats?.sent ?? '-'}</div><div className="sub">sent</div></div></div>
              <div className="tile span-4"><h4>Deliveries (last 30 days)</h4>
                {!series ? (<div className="placeholder">Loading...</div>) : (
                  <svg viewBox="0 0 120 120" width="100%" height="160">
                    {(() => {
                      const total = series.sent.reduce((a:number,b:number)=>a+b,0) + series.failed.reduce((a:number,b:number)=>a+b,0)
                      const sentPct = total ? (series.sent.reduce((a:number,b:number)=>a+b,0) / total) : 0
                      const r = 45, cx = 60, cy = 60, c = 2*Math.PI*r
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1b2444" strokeWidth="12" />
                          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1fd286" strokeWidth="12" strokeDasharray={`${sentPct*c} ${c}`} strokeDashoffset={c*0.25} transform={`rotate(-90 ${cx} ${cy})`} />
                          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="16" fontWeight="700" fill="currentColor">{Math.round(sentPct*100)}%</text>
                          <text x={cx} y={cy+18} textAnchor="middle" fontSize="10" fill="var(--muted)">Sent</text>
                        </g>
                      )
                    })()}
                  </svg>
                )}
              </div>
              <div className="tile span-8"><h4>Revenue (last 30 days)</h4>
                {!series ? (<div className="placeholder">Loading...</div>) : (
                  <svg viewBox="0 0 320 160" width="100%" height="160">
                    {(() => {
                      const values:number[] = series.revenue
                      const max = Math.max(1, ...values)
                      const pts = values.map((v:number, i:number) => {
                        const x = (i/(values.length-1)) * 300 + 10
                        const y = 140 - (v/max)*120
                        return [x,y]
                      })
                      const path = ['M', pts[0][0], pts[0][1]].concat(pts.slice(1).flatMap(p=>['L',p[0],p[1]])).join(' ')
                      const area = path + ` L ${pts[pts.length-1][0]} 140 L 10 140 Z`
                      return (
                        <g>
                          <rect x="10" y="20" width="300" height="120" fill="#0e142a" stroke="var(--border)" />
                          <path d={area} fill="rgba(108,140,255,0.25)" />
                          <path d={path} stroke="#6c8cff" strokeWidth="2" fill="none" />
                        </g>
                      )
                    })()}
                  </svg>
                )}
              </div>
              <div className="tile span-6"><h4>Revenue Graph</h4>
                {!series?.revenueQuarter ? (<div className="placeholder">Loading...</div>) : (
                  <svg viewBox="0 0 320 160" width="100%" height="160">
                    {(() => {
                      const vals:number[] = series.revenueQuarter
                      const max = Math.max(1, ...vals)
                      const bars = vals.map((v:number,i:number)=>{
                        const h = (v/max)*120
                        const x = 30 + i*90
                        const y = 140 - h
                        return {x,y,h}
                      })
                      return (
                        <g>
                          <rect x="10" y="20" width="300" height="120" fill="#0e142a" stroke="var(--border)" />
                          {bars.map((b,i)=> <rect key={i} x={b.x} y={b.y} width="60" height={b.h} fill={i===2?'#6c8cff':'#1fd286'} />)}
                          {series.months?.map((m:string,i:number)=> <text key={i} x={60 + i*90} y="154" textAnchor="middle" fontSize="10" fill="var(--muted)">{m}</text>)}
                        </g>
                      )
                    })()}
                  </svg>
                )}
              </div>
              <div className="tile span-6"><h4>Task Report</h4>
                {!series?.taskReport ? (<div className="placeholder">Loading...</div>) : (
                  <svg viewBox="0 0 320 160" width="100%" height="160">
                    {(() => {
                      const items = series.taskReport
                      const max = Math.max(1, ...items.map((i:any)=>i.done+i.pending))
                      return (
                        <g>
                          {items.map((t:any, idx:number)=>{
                            const y = 20 + idx*28
                            const doneW = (t.done/max)*240
                            const pendW = (t.pending/max)*240
                            return <g key={idx}>
                              <circle cx="18" cy={y+10} r="8" fill="#6c8cff" />
                              <rect x="32" y={y} width={pendW} height="20" fill="#6b4fd6" />
                              <rect x={32+pendW} y={y} width={doneW} height="20" fill="#22b8a6" />
                            </g>
                          })}
                        </g>
                      )
                    })()}
                  </svg>
                )}
              </div>
              <div className="tile span-6"><h4>By Milestone</h4>
                {!series?.milestone ? (<div className="placeholder">Loading...</div>) : (
                  <svg viewBox="0 0 320 160" width="100%" height="160">
                    {(() => {
                      const total = series.milestone.reduce((a:number,b:any)=>a+b.value,0) || 1
                      let start = 0
                      const r = 50, cx=80, cy=80, c = 2*Math.PI*r
                      return (
                        <g>
                          {series.milestone.map((m:any, i:number) => {
                            const frac = m.value/total
                            const dash = `${frac*c} ${c}`
                            const off = c*(start+0.25)
                            start += frac
                            const color = ['#6c8cff','#1fd286','#ff6b6b','#f5c26b'][i%4]
                            return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="12" strokeDasharray={dash} strokeDashoffset={off} transform={`rotate(-90 ${cx} ${cy})`} />
                          })}
                          <g transform="translate(160,20)" fontSize="11" fill="var(--muted)">
                            {series.milestone.map((m:any,i:number)=>{
                              const color = ['#6c8cff','#1fd286','#ff6b6b','#f5c26b'][i%4]
                              return <g key={i} transform={`translate(0,${i*18})`}>
                                <rect x="0" y="-8" width="10" height="10" fill={color} />
                                <text x="16" y="0">{m.label} ({m.value})</text>
                              </g>
                            })}
                          </g>
                        </g>
                      )
                    })()}
                  </svg>
                )}
              </div>
              <div className="tile span-6"><h4>Funnel</h4>
                {!series?.funnel ? (<div className="placeholder">Loading...</div>) : (
                  <svg viewBox="0 0 320 160" width="100%" height="160">
                    {(() => {
                      const max = Math.max(1, ...series.funnel.map((f:any)=>f.value))
                      const h = 24
                      return (
                        <g>
                          {series.funnel.map((f:any,i:number)=>{
                            const w = (f.value/max)*280
                            const y = 20 + i*(h+10)
                            const color = ['#6c8cff','#1fd286','#ff6b6b'][i%3]
                            return <g key={i}>
                              <rect x="20" y={y} width={w} height={h} fill={color} />
                              <text x={24} y={y+h/2} dominantBaseline="middle" fontSize="12" fill="#0b1020" fontWeight="700">{f.stage} ({f.value})</text>
                            </g>
                          })}
                        </g>
                      )
                    })()}
                  </svg>
                )}
              </div>
            </div>
            <div className="grid">
          <div className="card" id="segment">
            <h3>Create Segment</h3>
            <div className="field-row">
              <span>Join rules with</span>
              <select className="select" value={op} onChange={e => setOp(e.target.value as any)}>
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            </div>
            {rules.map((r, idx) => (
              <RuleRow key={idx} rule={r}
                onChange={(nr)=> setRules(prev => prev.map((x,i)=> i===idx?nr:x))}
                onDelete={()=> setRules(prev => prev.filter((_,i)=> i!==idx))}
              />
            ))}
            <button className="button secondary add" onClick={()=> setRules(prev => [...prev, { field:'visits', cmp:'<', value:3 }])}>+ Add Rule</button>
            <div className="kpi">
              <button className="button" onClick={preview}>Preview Audience</button>
              {audience !== null && <span>Audience Size: <span className="value">{audience}</span></span>}
            </div>
          </div>

          <div className="card">
            <h3>Natural language → Rules</h3>
            <div className="field-row">
              <input className="input" style={{ flex:1 }} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Describe your audience" />
              <button className="button" onClick={generateFromPrompt}>Generate Rules</button>
            </div>
            <hr className="sep" />
            <h3>Create Campaign</h3>
            <div className="field-row">
              <input className="input" style={{ flex:1 }} value={name} onChange={e => setName(e.target.value)} placeholder="Campaign name" />
            </div>
            <textarea className="textarea" value={msg} onChange={e => setMsg(e.target.value)} />
            <div className="kpi">
              <button className="button" onClick={async ()=>{
                const { data } = await axios.post(`${API}/api/ai/suggest-messages`, { objective: 'winback', tone: 'friendly' })
                if (data?.variants?.length) setMsg(data.variants[0].replace('{{name}}','there'))
              }}>Suggest Messages</button>
              <button className="button" onClick={createCampaign}>Save & Send</button>
              <button className="button secondary" onClick={async ()=>{
                try { await axios.post(`${API}/api/dev/seed`, {}, { headers: { 'x-seed-key': 'demo123' } }); alert('Seeded demo data!'); } catch(e:any){ alert('Seed failed'); }
              }}>Seed Demo Data</button>
            </div>
          </div>
          <div className="card">
            <h3>Quick Add (Local)</h3>
            <div className="field-row">
              <input className="input" placeholder="Customer name" id="qa_name" />
              <input className="input" placeholder="Email (optional)" id="qa_email" />
              <button className="button" onClick={async()=>{
                const name = (document.getElementById('qa_name') as HTMLInputElement).value.trim()
                const email = (document.getElementById('qa_email') as HTMLInputElement).value.trim() || undefined
                if (!name) return alert('Enter a name')
                await axios.post(`${API}/api/ingest/customers`, { name, email })
                ;(document.getElementById('qa_name') as HTMLInputElement).value = ''
                ;(document.getElementById('qa_email') as HTMLInputElement).value = ''
                await loadStats(); await loadSeries();
                alert('Customer added')
              }}>Add Customer</button>
            </div>
            <div className="field-row">
              <input className="input" placeholder="Search customer" id="qo_search" onChange={async(e)=>{
                const q = e.currentTarget.value
                const { data } = await axios.get(`${API}/api/customers`, { params: { q, limit: 20 } })
                const sel = document.getElementById('qo_cid') as HTMLSelectElement
                sel.innerHTML = ''
                for (const c of data) {
                  const opt = document.createElement('option')
                  opt.value = c.id; opt.textContent = `${c.name||'Unknown'}${c.email?` • ${c.email}`:''}`
                  sel.appendChild(opt)
                }
              }} />
              <select className="select" id="qo_cid"><option value="">Select customer…</option></select>
              <input className="input" type="number" placeholder="Amount" id="qo_amt" />
              <button className="button secondary" onClick={async()=>{
                const customerId = (document.getElementById('qo_cid') as HTMLSelectElement).value.trim()
                const amount = Number((document.getElementById('qo_amt') as HTMLInputElement).value)
                if (!customerId || !amount) return alert('Enter customerId and amount')
                await axios.post(`${API}/api/ingest/orders`, { customerId, amount })
                await loadStats(); await loadSeries();
                alert('Order added')
              }}>Add Order</button>
            </div>
          </div>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="panel" id="campaigns">
          <h3 style={{ margin: 0, flex: 1 }}>Campaigns</h3>
          <button className="button secondary" onClick={loadCampaigns}>Refresh</button>
        </div>
        {campaigns.length === 0 ? (
          <div className="empty">
            <div className="title">No campaigns yet</div>
            <div>Create a segment and click "Save & Send" to start a campaign.</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Created</th>
                <th align="left">Audience</th>
                <th align="left">Sent</th>
                <th align="left">Failed</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c:any) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{new Date(c.createdAt).toLocaleString()}</td>
                  <td><span className="badge">{c.audienceSize}</span></td>
                  <td><span className="badge">{c.sent}</span></td>
                  <td><span className="badge">{c.failed}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
