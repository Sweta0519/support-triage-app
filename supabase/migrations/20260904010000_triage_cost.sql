-- Optional task: usage/cost indicator. OpenRouter returns the real billed
-- cost in `usage.cost` on every response (embeddings and chat both) -- this
-- stores the combined per-run cost so staff see an actual charge, not an
-- estimate. numeric(12,8) comfortably holds sub-cent amounts without
-- floating-point rounding surprises.
alter table ticketing.triage_results
  add column cost_usd numeric(12, 8);

comment on column ticketing.triage_results.cost_usd is
  'Combined embedding + chat completion cost for this run, in USD, as billed by OpenRouter (usage.cost).';
