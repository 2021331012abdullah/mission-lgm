import { useEffect, useState } from "react";
import { days as defaultDays, handles as defaultHandles, type TrackerDay } from "@/data/tracker";
import { supabase } from "./supabase";

export type TrackerData = {
  handles: string[];
  days: TrackerDay[];
};

const KEY = "mission-lgm-tracker-v5-sust";
const DB_ID = "main_tracker";

const defaults: TrackerData = { handles: defaultHandles, days: defaultDays };

let state: TrackerData = defaults;
let stateRevision = 0;
let activeDBSyncPromise: Promise<boolean> | null = null;
let activeCFSyncPromise: Promise<boolean> | null = null;
let hasInitialHydrationStarted = false;

const listeners = new Set<(d: TrackerData) => void>();
const cfSyncListeners = new Set<(s: boolean) => void>();

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function emit() {
  listeners.forEach((l) => l(state));
}

function emitCFSync(syncing: boolean) {
  cfSyncListeners.forEach((l) => l(syncing));
}

export function useCFSyncStatus(): boolean {
  const [syncing, setSyncing] = useState<boolean>(Boolean(activeCFSyncPromise));
  useEffect(() => {
    cfSyncListeners.add(setSyncing);
    return () => { cfSyncListeners.delete(setSyncing); };
  }, []);
  return syncing;
}

// Helper: fetch user.status from Codeforces API with up to 3 retries and brief backoff
async function fetchWithRetry(handle: string, maxRetries = 3): Promise<any> {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const resp = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=5000`);
      if (!resp.ok) throw new Error(`HTTP status ${resp.status}`);
      const json = await resp.json();
      if (json.status === "OK") {
        return json;
      }
      throw new Error(`CF API status ${json.status}`);
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      // Brief pause before retry attempt
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
}

// 1. Fetch live solves, exact submission URLs & submission IDs from Codeforces API with 3 retries
export async function syncCFSolves(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // Concurrency lock: if a CF sync is already in flight across components, attach to existing promise
  if (activeCFSyncPromise) return activeCFSyncPromise;

  emitCFSync(true);

  activeCFSyncPromise = (async () => {
    try {
      const handles = state.handles.map((h) => h.trim()).filter(Boolean);
      const solvedMap = new Map<string, { solvedSet: Set<string>; urlMap: Map<string, string>; idMap: Map<string, string> }>();
      let allSucceeded = true;

      await Promise.all(
        handles.map(async (handle) => {
          const solvedSet = new Set<string>();
          const urlMap = new Map<string, string>();
          const idMap = new Map<string, string>();
          try {
            // Attempt fetch with up to 3 retries
            const json = await fetchWithRetry(handle, 3);
            if (Array.isArray(json.result)) {
              for (const sub of json.result) {
                if (sub.verdict === "OK" && sub.problem) {
                  const subId = String(sub.id);
                  const subUrl = sub.contestId
                    ? `https://codeforces.com/contest/${sub.contestId}/submission/${subId}`
                    : `https://codeforces.com/problemset/submission/${sub.problem.contestId || 0}/${subId}`;
                    
                  // Match ONLY by authoritative Problem ID (contestId + index), never by name
                  if (sub.problem.contestId && sub.problem.index) {
                    const key = `${sub.problem.contestId}${sub.problem.index}`.trim().toUpperCase();
                    solvedSet.add(key);
                    if (!urlMap.has(key)) urlMap.set(key, subUrl);
                    if (!idMap.has(key)) idMap.set(key, subId);
                  }
                }
              }
            }
          } catch (err) {
            console.warn(`CF API failed after 3 tries for handle ${handle}:`, err);
            allSucceeded = false;
          }
          solvedMap.set(handle, { solvedSet, urlMap, idMap });
        })
      );

      // If API failed for all handles after 3 retries, return false to trigger database fallback
      if (!allSucceeded && Array.from(solvedMap.values()).every((v) => v.solvedSet.size === 0)) {
        return false;
      }

      // Recompute solvedBy, submissionUrls, and submissionIds across all authoritative problems and days
      const updatedDays = clone(state.days).map((day) => ({
        ...day,
        problems: day.problems.map((prob) => {
          // Start fresh — do NOT carry over old submission data that may have been incorrectly name-matched
          const newSolvedBy: Record<string, boolean> = {};
          const newSubmissionUrls: Record<string, string> = {};
          const newSubmissionIds: Record<string, string> = {};
          
          const probIdKey = prob.id ? prob.id.trim().toUpperCase() : "";

          handles.forEach((handle) => {
            const userData = solvedMap.get(handle);
            if (userData && probIdKey && userData.solvedSet.has(probIdKey)) {
              newSolvedBy[handle] = true;
              const link = userData.urlMap.get(probIdKey);
              const sId = userData.idMap.get(probIdKey);
              if (link) newSubmissionUrls[handle] = link;
              if (sId) newSubmissionIds[handle] = sId;
            } else {
              newSolvedBy[handle] = false;
            }
          });
          return { ...prob, solvedBy: newSolvedBy, submissionUrls: newSubmissionUrls, submissionIds: newSubmissionIds };
        })
      }));

      const nextState = normalize({ handles, days: updatedDays });
      
      // If CF sync is successful, immediately update local storage AND push latest submission IDs to Supabase database!
      await setTrackerData(nextState);

      return true;
    } catch (e) {
      console.error("Error during CF solve sync:", e);
      return false;
    } finally {
      activeCFSyncPromise = null;
      emitCFSync(false);
    }
  })();

  return activeCFSyncPromise;
}

// 2. Direct Sync from Supabase Cloud Database (Used as baseline schema sync or fallback on CF failure)
export async function syncFromDatabase(): Promise<boolean> {
  if (!supabase) return false;
  if (activeDBSyncPromise) return activeDBSyncPromise;

  const startRevision = stateRevision;
  activeDBSyncPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from("tracker_state")
        .select("data")
        .eq("id", DB_ID)
        .maybeSingle();

      // If local modifications occurred while the database query was in flight, do not overwrite state!
      if (stateRevision !== startRevision) {
        return true;
      }

      if (!error && data && data.data) {
        const parsed = data.data as any;
        const handles = Array.isArray(parsed.handles) ? parsed.handles : state.handles;
        const days = Array.isArray(parsed.days) ? parsed.days : state.days;
        if (Array.isArray(days)) {
          state = normalize({ handles, days });
          if (typeof window !== "undefined") {
            try {
              // Update localStorage with Supabase authoritative snapshot
              window.localStorage.setItem(KEY, JSON.stringify(state));
            } catch {}
          }
          emit();
          return true;
        }
      } else if (!data && !error) {
        // Table is empty; seed it with our current normalized state
        await supabase.from("tracker_state").upsert({
          id: DB_ID,
          data: state,
          updated_at: new Date().toISOString()
        });
        return true;
      }
      if (error) console.error("Supabase error during sync:", error);
      return false;
    } catch (e) {
      console.error("Supabase sync failed:", e);
      return false;
    } finally {
      activeDBSyncPromise = null;
    }
  })();

  return activeDBSyncPromise;
}

/** Synchronously retrieve the current state without invoking React hooks in async callbacks */
export function getTrackerState(): TrackerData {
  return state;
}

// 3. Realtime WebSocket Subscription to keep Frontend and Admin automatically synced with database
if (supabase && typeof window !== "undefined") {
  supabase
    .channel("tracker-realtime-channel")
    .on("postgres_changes", { event: "*", schema: "public", table: "tracker_state" }, (payload) => {
      if (payload.new && "data" in payload.new && payload.new.data) {
        const updated = payload.new.data as TrackerData;
        if (Array.isArray(updated.handles) && Array.isArray(updated.days)) {
          state = normalize(updated);
          try {
            window.localStorage.setItem(KEY, JSON.stringify(state));
          } catch {}
          emit();
        }
      }
    })
    .subscribe();
}

export async function setTrackerData(next: TrackerData): Promise<boolean> {
  const normalized = normalize(next);
  state = normalized;
  stateRevision++;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(normalized));
    } catch {
      /* ignore quota errors */
    }
  }
  emit();

  // Atomic save to permanent Supabase cloud storage (syncing latest submissions and edits)
  if (supabase) {
    try {
      const { error } = await supabase
        .from("tracker_state")
        .upsert({ id: DB_ID, data: normalized, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) {
        console.error("Supabase save error:", error);
        return false;
      }
      return true;
    } catch (e) {
      console.error("Supabase network failure:", e);
      return false;
    }
  }
  return false;
}

/** Sort days newest-first and keep every problem's solvedBy, submissionUrls, and submissionIds keyed by current handles. */
export function normalize(data: TrackerData): TrackerData {
  const handles = data.handles.map((h) => h.trim()).filter(Boolean);
  const days = clone(data.days)
    .map((d) => ({
      ...d,
      problems: d.problems.map((p) => {
        const solvedBy: Record<string, boolean> = {};
        const submissionUrls: Record<string, string> = {};
        const submissionIds: Record<string, string> = {};
        handles.forEach((h) => {
          solvedBy[h] = Boolean(p.solvedBy?.[h]);
          if (p.submissionUrls?.[h]) submissionUrls[h] = p.submissionUrls[h];
          if (p.submissionIds?.[h]) submissionIds[h] = p.submissionIds[h];
        });
        return { ...p, solvedBy, submissionUrls, submissionIds };
      }),
    }))
  return { handles, days };
}

/** Await any active database or Codeforces synchronization before generating screenshots or exporting data. */
export async function waitForInitialSyncs(): Promise<void> {
  const promises: Promise<any>[] = [];
  if (activeDBSyncPromise) promises.push(activeDBSyncPromise);
  if (activeCFSyncPromise) promises.push(activeCFSyncPromise);
  if (promises.length > 0) {
    await Promise.allSettled(promises);
  }
}

export function useTracker(): TrackerData {
  const [data, setData] = useState<TrackerData>(state);
  
  useEffect(() => {
    listeners.add(setData);
    
    // Step 1: Immediately upon component mount, load & display cached data from local storage with zero delay!
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TrackerData;
        if (Array.isArray(parsed.handles) && Array.isArray(parsed.days)) {
          state = normalize(parsed);
          setData(state);
        }
      }
    } catch {}

    // Ensure initial background orchestration only fires once per window hydration
    if (!hasInitialHydrationStarted) {
      hasInitialHydrationStarted = true;
      (async () => {
        // Step 2: First pull authoritative state from Supabase database to avoid concurrency conflicts
        await syncFromDatabase();
        // Step 3: Once database snapshot is confirmed, synchronize live CF solve status
        const cfSuccess = await syncCFSolves();
        if (!cfSuccess) {
          console.warn("CF API offline or retries exhausted. Using authoritative database snapshot.");
        }
      })();
    }

    return () => {
      listeners.delete(setData);
    };
  }, []);
  
  return data;
}
