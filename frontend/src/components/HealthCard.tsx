// « Santé du projet & budget » (maquettes A et B) : chiffres et pourcentages calculés par le backend.
import type { Dashboard } from '../services/types.ts'
import { useApp } from '../store/app.ts'
import { TREND_LABEL, TREND_STATUS } from '../lib/labels.ts'
import { hours, percent } from '../lib/format.ts'
import { Card, Eyebrow, ProgressBar } from './ui.tsx'

function daysLong(value: number): string {
  return `${value.toFixed(1)} Jours`
}

export function HealthCard({ dashboard }: { dashboard: Dashboard }) {
  const setView = useApp((state) => state.setView)
  const { budget, progress, trend } = dashboard
  const over = budget.balance?.kind === 'OVER'

  return (
    <Card className="grid gap-6 p-5 lg:grid-cols-[minmax(15rem,1fr)_minmax(0,1.25fr)_minmax(0,1.25fr)] lg:items-start">
      <div className="space-y-2.5">
        <Eyebrow>Santé du projet &amp; budget</Eyebrow>
        {budget.initial ? (
          <dl className="space-y-1.5 text-[15px]">
            <div>
              <dt className="inline">Budget Initial : </dt>
              <dd className="inline font-semibold">
                {daysLong(budget.initial.days)} <span className="font-normal text-muted">({hours(budget.initial.hours)})</span>
              </dd>
            </div>
            <div>
              <dt className="inline">Temps Réalisé : </dt>
              <dd className="inline font-semibold">
                {daysLong(budget.spent.days)} <span className="font-normal text-muted">({hours(budget.spent.hours)})</span>
              </dd>
            </div>
            {budget.balance && (
              <div>
                <dt className="inline">{budget.balance.kind === 'OVER' ? 'Dépassement : ' : 'Reste : '}</dt>
                <dd className="inline font-semibold" data-status={budget.balance.kind === 'OVER' ? 'REJECTED' : undefined}>
                  <span className={budget.balance.kind === 'OVER' ? 'ds-ink' : ''}>
                    {budget.balance.kind === 'OVER' ? '+' : ''}
                    {daysLong(budget.balance.delta.days)}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <div className="space-y-1.5 text-[15px]">
            <p>
              Temps Réalisé : <span className="font-semibold">{daysLong(budget.spent.days)}</span>{' '}
              <span className="text-muted">({hours(budget.spent.hours)})</span>
            </p>
            <p className="text-muted">
              Aucun budget initial.{' '}
              <button type="button" className="text-accent-ink underline underline-offset-2" onClick={() => setView('settings')}>
                Le définir
              </button>
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3 lg:pt-7">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-semibold">Progression Budget</span>
          <span className="font-semibold tabular-nums text-accent-ink">{percent(budget.consumedPercent)}</span>
        </div>
        <ProgressBar value={budget.consumedPercent} tone={over ? 'over' : 'budget'} label="Progression du budget consommé" />
        <p className="text-xs text-muted">Temps réalisé / budget initial</p>
      </div>

      <div className="space-y-3 lg:pt-7">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-semibold">Avancement Réel</span>
          <span className="ds-ink font-semibold tabular-nums" data-status="CLOSED">
            {percent(progress.percent)}
          </span>
        </div>
        <ProgressBar value={progress.percent} tone="progress" label="Avancement réel du projet" />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">Pondéré par les estimations</p>
          {trend && (
            <span className="ds-badge" data-status={TREND_STATUS[trend]} data-plain="">
              {TREND_LABEL[trend]}
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}
