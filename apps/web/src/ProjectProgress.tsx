import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from './api';
import type { ProgressPoint } from './types';

const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
export function progressPlot(points: ProgressPoint[], width?: number) {
  return <LineChart width={width} height={240} data={points} margin={{ top: 16, right: 16, bottom: 4, left: 0 }} accessibilityLayer>
    <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 3" />
    <XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fontSize: 11, fill: 'var(--muted)' }} minTickGap={32} tickLine={false} axisLine={false} />
    <YAxis allowDecimals={false} width={32} domain={[0, (max: number) => Math.max(1, max)]} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
    <Tooltip labelFormatter={(value) => dateLabel(String(value))} contentStyle={{ background: 'var(--surface)', borderColor: 'var(--line)', borderRadius: 6, fontSize: 12, color: 'var(--text)' }} />
    <Line type="stepAfter" dataKey="total" name="Total de tarefas" stroke="#4881ee" strokeWidth={2} strokeDasharray="5 4" dot={{ r: points.length === 1 ? 5 : 2 }} isAnimationActive={false} />
    <Line type="stepAfter" dataKey="completed" name="Concluidas" stroke="#1caa79" strokeWidth={3} dot={{ r: points.length === 1 ? 5 : 2 }} isAnimationActive={false} />
  </LineChart>;
}
export function ProjectProgress({ projectId, total, completed, revision }: { projectId: string; total: number; completed: number; revision: string }) {
  const [days, setDays] = useState('30'); const [data, setData] = useState<{ points: ProgressPoint[]; startedAt: string | null } | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    function load() {
      void api<{ points: ProgressPoint[]; startedAt: string | null }>(`/projects/${projectId}/progress?days=${days}`)
        .then((result) => { if (active) { setData(result); setError(''); } }).catch((error) => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    }
    load(); const timer = window.setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [projectId, days, revision, refresh]);
  const percent = total ? Math.round(completed / total * 100) : 0;
  return <section className="dashboard-section project-evolution" aria-label="Evolucao do projeto">
    <div className="section-heading"><div><h3>Evolucao do projeto</h3><p className="muted">{completed} de {total} tarefas concluidas</p></div>
      <div className="progress-controls"><strong className="progress-percentage">{percent}%</strong><div className="period-control" role="group" aria-label="Periodo do grafico">
        {['7', '30', '90'].map((value) => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{value} dias</button>)}
      </div></div>
    </div>
    <progress className="completion-track" aria-label="Conclusao do projeto" value={completed} max={Math.max(total, 1)} />
    {error ? <div className="progress-chart"><p className="error" role="alert">{error}</p><button className="icon-button" title="Atualizar grafico" aria-label="Atualizar grafico" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={17} /></button></div> : <div className="progress-chart" aria-busy={loading}>
      {data?.points.length ? <ResponsiveContainer width="100%" height={240} minWidth={0}>{progressPlot(data.points)}</ResponsiveContainer> : <div className="empty-state" role="status">{loading ? 'Carregando evolucao...' : 'Sem registros no periodo.'}</div>}
    </div>}
    <div className="progress-legend"><span><i className="total-key" />Total de tarefas</span><span><i className="completed-key" />Concluidas</span>{data?.startedAt && <small>Historico desde {dateLabel(data.startedAt)}</small>}</div>
  </section>;
}
