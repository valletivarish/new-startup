'use client';

/**
 * Costs (platform owner only): which outside services we pay for, what each call cost by part,
 * and how the three voice engines compare on cost per completed screen and quality. Rates are
 * edited here; every priced call keeps the rates it was priced with.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input, Select } from '@/components/ui/input';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import {
  getCostSummary,
  listCostCalls,
  listCostServices,
  rateCostCall,
  updateCostService,
  type CostCall,
  type CostServiceRow,
  ENGINE_LABEL,
} from '@/lib/api';
import { toUserMessage } from '@/lib/errors';
import { useMe } from '@/lib/use-me';

const CARD = 'rounded-card border border-border bg-canvas p-5 sm:p-6';
const TABLE_WRAP = 'mt-4 overflow-x-auto';
const TH = 'whitespace-nowrap px-3 py-2 text-left text-label font-medium text-text-2';
const TD = 'whitespace-nowrap px-3 py-2.5 text-body text-text tabular-nums';

const BILLING_LABEL: Record<CostServiceRow['billing'], string> = {
  per_minute: '₹ / minute',
  per_1k_chars: '₹ / 1k characters',
  per_1m_tokens_in: '₹ / 1M input tokens',
  per_1m_tokens_out: '₹ / 1M output tokens',
  per_credit: '₹ / credit',
  monthly_fixed: '₹ / month',
};

const STATUS_LABEL: Record<CostServiceRow['status'], string> = {
  in_use: 'In use',
  testing: 'Testing',
  off: 'Off',
};

function inr(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function CostsPage() {
  const me = useMe();
  const [month, setMonth] = useState(thisMonth);
  const allowed = me.data?.isPlatformAdmin === true;

  const summary = useQuery({
    queryKey: ['admin-costs', 'summary', month],
    queryFn: () => getCostSummary(month),
    enabled: allowed,
  });

  if (me.isSuccess && !allowed) {
    return (
      <AppShell profile={me.data}>
        <PageMain>
          <EmptyState title="Page not found" description="This page isn't available in your workspace." />
        </PageMain>
      </AppShell>
    );
  }

  const s = summary.data?.summary;
  return (
    <AppShell profile={me.data ?? null} title="Costs">
      <PageMain>
        <PageHeader
          title="Costs"
          description="Every outside service we pay for, what each call cost, and how the voice engines compare."
          actions={
            <Input
              type="month"
              aria-label="Month"
              value={month}
              max={thisMonth()}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          }
        />

        {summary.isError ? (
          <ErrorState
            title="Couldn't load costs"
            cause={toUserMessage(summary.error).detail}
            onRetry={() => void summary.refetch()}
            retrying={summary.isFetching}
          />
        ) : !s ? (
          <SkeletonGroup>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="mt-6 h-56 w-full" />
          </SkeletonGroup>
        ) : (
          <div className="flex flex-col gap-6">
            <section className={CARD} aria-labelledby="spend-h">
              <h2 id="spend-h" className="m-0 text-title text-text">
                This month&apos;s spend
              </h2>
              <p className="m-0 mt-1 text-body text-text-2">
                Usage {inr(s.usageTotalInr)} · Fixed {inr(s.fixedTotalInr, 0)} ·{' '}
                <strong className="text-text">Total {inr(s.usageTotalInr + s.fixedTotalInr)}</strong>
              </p>
              <div className={TABLE_WRAP}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={TH}>Service</th>
                      <th className={TH}>Vendor</th>
                      <th className={TH}>Status</th>
                      <th className={`${TH} text-right`}>Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.services.map((svc) => (
                      <tr key={svc.key} className="border-b border-border last:border-0">
                        <td className={TD}>{svc.name}</td>
                        <td className={TD}>{svc.vendor}</td>
                        <td className={TD}>{STATUS_LABEL[svc.status as CostServiceRow['status']] ?? svc.status}</td>
                        <td className={`${TD} text-right`}>
                          {inr(svc.spendInr)}
                          {svc.billing === 'monthly_fixed' ? <span className="text-text-3"> fixed</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={CARD} aria-labelledby="arms-h">
              <h2 id="arms-h" className="m-0 text-title text-text">
                Voice engines compared
              </h2>
              <p className="m-0 mt-1 text-body text-text-2">
                A completed screen is a call where the candidate spoke and the call ran 20 seconds or more.
              </p>
              <div className={TABLE_WRAP}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={TH}>Engine</th>
                      <th className={`${TH} text-right`}>Calls</th>
                      <th className={`${TH} text-right`}>Completed</th>
                      <th className={`${TH} text-right`}>Minutes</th>
                      <th className={`${TH} text-right`}>Cost / min</th>
                      <th className={`${TH} text-right`}>Cost / completed screen</th>
                      <th className={`${TH} text-right`}>Median reply</th>
                      <th className={`${TH} text-right`}>Completion</th>
                      <th className={`${TH} text-right`}>Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.arms.map((arm) => (
                      <tr key={arm.engine} className="border-b border-border last:border-0">
                        <td className={TD}>{ENGINE_LABEL[arm.engine]}</td>
                        <td className={`${TD} text-right`}>{arm.calls}</td>
                        <td className={`${TD} text-right`}>{arm.completedScreens}</td>
                        <td className={`${TD} text-right`}>{arm.minutes}</td>
                        <td className={`${TD} text-right`}>{inr(arm.costPerMinute)}</td>
                        <td className={`${TD} text-right font-medium`}>{inr(arm.costPerCompletedScreen)}</td>
                        <td className={`${TD} text-right`}>
                          {arm.medianResponseMs === null ? '—' : `${(arm.medianResponseMs / 1000).toFixed(2)} s`}
                        </td>
                        <td className={`${TD} text-right`}>
                          {arm.completionRate === null ? '—' : `${arm.completionRate}%`}
                        </td>
                        <td className={`${TD} text-right`}>
                          {arm.avgRating === null ? '—' : `${arm.avgRating} / 5 (${arm.ratedCalls})`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <ServicesCard />
            <CallsCard />
          </div>
        )}
      </PageMain>
    </AppShell>
  );
}

function ServicesCard() {
  const queryClient = useQueryClient();
  const services = useQuery({ queryKey: ['admin-costs', 'services'], queryFn: listCostServices });
  return (
    <section className={CARD} aria-labelledby="services-h">
      <h2 id="services-h" className="m-0 text-title text-text">
        Services and rates
      </h2>
      <p className="m-0 mt-1 text-body text-text-2">
        Rates in rupees, before GST. Changing a rate prices new calls only.
      </p>
      {services.isError ? (
        <ErrorState title="Couldn't load services" cause={toUserMessage(services.error).detail} onRetry={() => void services.refetch()} />
      ) : (
        <div className={TABLE_WRAP}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>Service</th>
                <th className={TH}>Used for</th>
                <th className={TH}>Billing</th>
                <th className={TH}>Rate</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(services.data?.services ?? []).map((svc) => (
                <ServiceRow
                  key={`${svc.key}-${svc.updatedAt}`}
                  svc={svc}
                  onSaved={() => void queryClient.invalidateQueries({ queryKey: ['admin-costs'] })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ServiceRow({ svc, onSaved }: { svc: CostServiceRow; onSaved: () => void }) {
  const [rate, setRate] = useState(String(svc.rateInr));
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateCostService>[1]) => updateCostService(svc.key, patch),
    onSuccess: () => {
      toast.success(`${svc.name} updated`);
      onSaved();
    },
    onError: (err) => toast.error(toUserMessage(err).detail),
  });
  const parsed = Number(rate);
  const dirty = rate.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed !== svc.rateInr;
  return (
    <tr className="border-b border-border last:border-0">
      <td className={TD}>
        <div className="font-medium">{svc.name}</div>
        <div className="text-label text-text-3">{svc.vendor}</div>
      </td>
      <td className={`${TD} whitespace-normal`}>{svc.usedFor}</td>
      <td className={TD}>{BILLING_LABEL[svc.billing]}</td>
      <td className={TD}>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) save.mutate({ rateInr: parsed });
          }}
        >
          <Input
            aria-label={`${svc.name} rate`}
            inputMode="decimal"
            className="w-28"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          {dirty ? (
            <Button type="submit" size="sm" variant="secondary" disabled={save.isPending}>
              Save
            </Button>
          ) : null}
        </form>
      </td>
      <td className={TD}>
        <Select
          aria-label={`${svc.name} status`}
          value={svc.status}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ status: e.target.value as CostServiceRow['status'] })}
        >
          <option value="in_use">In use</option>
          <option value="testing">Testing</option>
          <option value="off">Off</option>
        </Select>
      </td>
    </tr>
  );
}

function CallsCard() {
  const calls = useQuery({ queryKey: ['admin-costs', 'calls'], queryFn: listCostCalls });
  const list = calls.data?.calls ?? [];
  return (
    <section className={CARD} aria-labelledby="calls-h">
      <h2 id="calls-h" className="m-0 text-title text-text">
        Calls
      </h2>
      <p className="m-0 mt-1 text-body text-text-2">Latest 100 calls across every company, cost split by part.</p>
      {calls.isError ? (
        <ErrorState title="Couldn't load calls" cause={toUserMessage(calls.error).detail} onRetry={() => void calls.refetch()} />
      ) : calls.isSuccess && list.length === 0 ? (
        <p className="m-0 mt-4 text-body text-text-2">No priced calls yet. Calls appear here when they end.</p>
      ) : (
        <div className={TABLE_WRAP}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>When</th>
                <th className={TH}>Company</th>
                <th className={TH}>Engine</th>
                <th className={TH}>Outcome</th>
                <th className={`${TH} text-right`}>Length</th>
                <th className={`${TH} text-right`}>Phone</th>
                <th className={`${TH} text-right`}>Listen</th>
                <th className={`${TH} text-right`}>Think</th>
                <th className={`${TH} text-right`}>Voice</th>
                <th className={`${TH} text-right`}>Agent</th>
                <th className={`${TH} text-right`}>Total</th>
                <th className={`${TH} text-right`}>Reply</th>
                <th className={TH}>Rating</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <CallRow key={c.voiceSessionId} call={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CallRow({ call }: { call: CostCall }) {
  const queryClient = useQueryClient();
  const rate = useMutation({
    mutationFn: (rating: number) => rateCostCall(call.voiceSessionId, rating, call.qualityNote),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-costs'] }),
    onError: (err) => toast.error(toUserMessage(err).detail),
  });
  const when = new Date(call.createdAt).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <tr className="border-b border-border last:border-0">
      <td className={TD}>{when}</td>
      <td className={TD}>{call.organizationName}</td>
      <td className={TD}>{call.engine ? ENGINE_LABEL[call.engine] : '—'}</td>
      <td className={TD}>{call.outcome.replace('_', ' ')}</td>
      <td className={`${TD} text-right`}>
        {call.connectedSeconds === null ? '—' : `${Math.floor(call.connectedSeconds / 60)}:${String(call.connectedSeconds % 60).padStart(2, '0')}`}
      </td>
      <td className={`${TD} text-right`} title={call.telephonyBilled ? "Exotel's billed price" : 'Estimated'}>
        {inr(call.telephonyCost)}
        {call.telephonyBilled ? null : <span className="text-text-3">*</span>}
      </td>
      <td className={`${TD} text-right`}>{inr(call.sttCost)}</td>
      <td className={`${TD} text-right`}>{inr(call.llmCost)}</td>
      <td className={`${TD} text-right`}>{inr(call.ttsCost)}</td>
      <td className={`${TD} text-right`}>{inr(call.agentCost)}</td>
      <td className={`${TD} text-right font-medium`}>{inr(call.totalCost)}</td>
      <td className={`${TD} text-right`}>
        {call.responseP50Ms === null ? '—' : `${(call.responseP50Ms / 1000).toFixed(2)} s`}
      </td>
      <td className={TD}>
        <Select
          aria-label="Quality rating"
          value={call.qualityRating ?? ''}
          disabled={rate.isPending}
          onChange={(e) => e.target.value && rate.mutate(Number(e.target.value))}
        >
          <option value="">Rate…</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} / 5
            </option>
          ))}
        </Select>
      </td>
    </tr>
  );
}
