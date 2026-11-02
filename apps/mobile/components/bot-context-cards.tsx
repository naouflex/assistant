import type { MemoryDocument, MemoryDream, MemoryProposal, ScratchpadItem } from "@atlas/contracts";
import { isEmptyBotMemory } from "@atlas/contracts";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { errorText } from "../lib/user-error";
import { NativeSymbol } from "./native-symbol";
import { ProfileEditDialog } from "./profile-edit-dialog";

export function BotContextCards({ botId }: { botId: string }) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [work, setWork] = useState<ScratchpadItem[]>([]);
  const [docs, setDocs] = useState<MemoryDocument[]>([]);
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);
  const [dream, setDream] = useState<MemoryDream | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [nothingToChange, setNothingToChange] = useState(false);
  const [allWork, setAllWork] = useState(false);
  const [allDocs, setAllDocs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void rpc("scratchpad/list", { botId })
      .then((items) => {
        if (current) setWork(items);
      })
      .catch((err) => {
        if (current) setError(errorText(err));
      });
    void rpc("memory/list", { botId, scope: "bot" })
      .then((documents) => {
        if (current) setDocs(documents.filter((doc) => !isEmptyBotMemory(doc)));
      })
      .catch((err) => {
        if (current) setError(errorText(err));
      });
    void rpc("memory/proposals", { botId, scope: "bot" })
      .then((rows) => {
        if (current) setProposals(proposalsFrom(rows));
      })
      .catch(() => undefined);
    void rpc("memory/dream", { botId, scope: "bot" })
      .then((row) => {
        if (current) setDream(dreamFrom(row));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [botId]);
  const reviewing = dream?.status === "queued" || dream?.status === "running";
  useEffect(() => {
    if (!reviewing) return;
    const timer = setInterval(() => {
      void rpc("memory/dream", { botId, scope: "bot" }).then((row) => setDream(dreamFrom(row)));
      void rpc("memory/proposals", { botId, scope: "bot" }).then((rows) =>
        setProposals(proposalsFrom(rows)),
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [botId, reviewing]);
  useEffect(() => {
    if (!reviewId || dream?.id !== reviewId) return;
    if (dream.status === "queued" || dream.status === "running") return;
    setReviewId(null);
    setNothingToChange(dream.status === "ready" && proposals.length === 0);
  }, [reviewId, dream, proposals.length]);
  const heading = { color: tokens.mutedForeground, fontSize: 12, fontWeight: "500" as const };
  const card = { backgroundColor: native.fill, borderRadius: 12, padding: 16, gap: 12 };
  return (
    <>
      {work.length ? (
        <View style={{ marginTop: 24 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
              paddingEnd: 16,
            }}
          >
            <Text accessibilityRole="header" style={heading}>
              {t("Open work")}
            </Text>
            <ProfileEditDialog
              value=""
              label={t("Add open work")}
              editLabel={t("Add open work")}
              maxLength={200}
              icon="plus"
              onCommit={async (title) => {
                if (!title || busy) return;
                setBusy(true);
                try {
                  const item = await rpc("scratchpad/create", { botId, title });
                  setWork((items) => [item, ...items]);
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </View>
          <View style={card}>
            {(allWork ? work : work.slice(0, 5)).map((item) => (
              <View
                key={item.id}
                style={{ minHeight: 44, flexDirection: "row", gap: 12, alignItems: "center" }}
              >
                <Pressable
                  accessibilityLabel={`${t("Complete")} ${item.title}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: false }}
                  hitSlop={11}
                  style={{
                    width: 22,
                    minHeight: 22,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    void rpc("scratchpad/update", { itemId: item.id, status: "done" })
                      .then(() => setWork((items) => items.filter((entry) => entry.id !== item.id)))
                      .catch((err) => setError(errorText(err)))
                      .finally(() => setBusy(false));
                  }}
                >
                  <NativeSymbol
                    ios="circle"
                    android="ellipse-outline"
                    size={22}
                    color={tokens.mutedForeground}
                  />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: tokens.foreground, fontSize: 14 }}>{item.title}</Text>
                  {item.notes ? (
                    <Text style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 4 }}>
                      {item.notes}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
            {!allWork && work.length > 5 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setAllWork(true)}
                style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: tokens.mutedForeground }}>{t("Show more")}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      {docs.length || proposals.length ? (
        <View style={{ marginTop: 24 }}>
          <Text accessibilityRole="header" style={[heading, { marginBottom: 8 }]}>
            {t("Memory")}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy || reviewing}
            onPress={() => {
              if (busy || reviewing) return;
              setBusy(true);
              setNothingToChange(false);
              void rpc("memory/startDream", { botId, scope: "bot" })
                .then((row) => {
                  const started = dreamFrom(row);
                  setDream(started);
                  setReviewId(started?.id ?? null);
                })
                .catch((err) => setError(errorText(err)))
                .finally(() => setBusy(false));
            }}
            style={{ minHeight: 44, justifyContent: "center", marginBottom: 8 }}
          >
            <Text style={{ color: tokens.foreground, fontSize: 14 }}>
              {t("Review recent runs")}
            </Text>
          </Pressable>
          {reviewing ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginBottom: 8 }}>
              {t("Reviewing recent runs")}
            </Text>
          ) : null}
          {dream?.status === "failed" && dream.error ? (
            <Text style={{ color: tokens.destructive, fontSize: 13, marginBottom: 8 }}>
              {dream.error}
            </Text>
          ) : null}
          {nothingToChange ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginBottom: 8 }}>
              {t("Nothing to change")}
            </Text>
          ) : null}
          {proposals.length ? (
            <View style={[card, { marginBottom: 12 }]}>
              <Text style={heading}>{t("Proposed notes")}</Text>
              {proposals.map((proposal) => (
                <View key={proposal.id} style={{ gap: 8 }}>
                  <Text style={{ color: tokens.foreground, fontSize: 14 }}>{proposal.path}</Text>
                  <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
                    {proposal.reason}
                  </Text>
                  <Text style={{ color: tokens.foreground, fontSize: 13 }}>{proposal.content}</Text>
                  <View style={{ flexDirection: "row", gap: 16 }}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => {
                        if (busy) return;
                        setBusy(true);
                        void rpc("memory/acceptProposal", { proposalId: proposal.id })
                          .then((updated) => {
                            setDocs((items) => {
                              const index = items.findIndex((entry) => entry.path === updated.path);
                              if (index < 0) return [updated, ...items];
                              return items.map((entry, position) =>
                                position === index ? updated : entry,
                              );
                            });
                            setProposals((items) =>
                              items.filter((entry) => entry.id !== proposal.id),
                            );
                            setNothingToChange(false);
                          })
                          .catch((err) => setError(errorText(err)))
                          .finally(() => setBusy(false));
                      }}
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <Text style={{ color: tokens.foreground }}>{t("Accept")}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => {
                        if (busy) return;
                        setBusy(true);
                        void rpc("memory/rejectProposal", { proposalId: proposal.id })
                          .then(() =>
                            setProposals((items) =>
                              items.filter((entry) => entry.id !== proposal.id),
                            ),
                          )
                          .catch((err) => setError(errorText(err)))
                          .finally(() => setBusy(false));
                      }}
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <Text style={{ color: tokens.foreground }}>{t("Reject")}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {docs.length ? (
            <View style={card}>
              {(allDocs ? docs : docs.slice(0, 5)).map((doc) => (
                <Pressable
                  key={doc.id}
                  accessibilityRole="button"
                  accessibilityLabel={doc.path}
                  onPress={() => Alert.alert(doc.path, doc.content)}
                  style={{
                    minHeight: 44,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{ color: tokens.foreground, fontSize: 14, flex: 1 }}
                  >
                    {doc.path}
                  </Text>
                  <NativeSymbol
                    ios="chevron.right"
                    android="chevron-forward"
                    size={14}
                    color={native.tertiaryLabel}
                  />
                </Pressable>
              ))}
              {!allDocs && docs.length > 5 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setAllDocs(true)}
                  style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ color: tokens.mutedForeground }}>{t("Show more")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {error ? <Text style={{ color: tokens.destructive, marginTop: 16 }}>{error}</Text> : null}
    </>
  );
}

function proposalsFrom(value: unknown): MemoryProposal[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is MemoryProposal =>
      !!item &&
      typeof item === "object" &&
      typeof (item as { reason?: unknown }).reason === "string",
  );
}

function dreamFrom(value: unknown): MemoryDream | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof (value as { status?: unknown }).status !== "string") return null;
  return value as MemoryDream;
}
