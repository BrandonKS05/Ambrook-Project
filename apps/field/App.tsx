import NetInfo from "@react-native-community/netinfo";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { formatCents, parseMoney, scheduleFLabel, type ScheduleFLineId } from "@saddlebag/domain";
import type { LocalReceipt } from "@saddlebag/sync";

import { DEFAULT_BARN_URL, initAppModel, type AppModel } from "./src/app-model";

const ink = "#2b2620";
const paper = "#f4f1ea";
const card = "#fffdf8";

type PickedImage = { base64: string; uri: string };

export default function App() {
  const [model, setModel] = useState<AppModel | null>(null);
  const [receipts, setReceipts] = useState<LocalReceipt[]>([]);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState<boolean | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncing = useRef(false);

  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [image, setImage] = useState<PickedImage | null>(null);
  const [barnUrl, setBarnUrl] = useState(DEFAULT_BARN_URL);

  const refresh = useCallback(async (m: AppModel) => {
    setReceipts(await m.engine.list());
    setPending(await m.engine.pendingCount());
  }, []);

  const sync = useCallback(
    async (m: AppModel) => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        await m.engine.flush();
        setSyncError(null);
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : "sync failed");
      } finally {
        syncing.current = false;
        await refresh(m);
      }
    },
    [refresh],
  );

  useEffect(() => {
    let mounted = true;
    initAppModel().then(async (m) => {
      if (!mounted) return;
      setModel(m);
      setBarnUrl(m.transport.url);
      await refresh(m);
      await sync(m);
    });
    return () => {
      mounted = false;
    };
  }, [refresh, sync]);

  useEffect(() => {
    if (model === null) return;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected === true;
      setOnline(connected);
      if (connected) void sync(model);
    });
    const timer = setInterval(() => void sync(model), 20_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [model, sync]);

  const pick = async (camera: boolean) => {
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const options = { base64: true, quality: 0.35 } as const;
    const result = camera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync({ ...options, mediaTypes: ["images"] });
    const asset = result.canceled ? null : (result.assets[0] ?? null);
    if (asset?.base64) setImage({ base64: asset.base64, uri: asset.uri });
  };

  const stash = async () => {
    if (model === null) return;
    const totalCents = amount.trim() === "" ? null : parseMoney(amount);
    if (amount.trim() !== "" && totalCents === null) {
      Alert.alert("Amount looks off", 'Try something like "184.37".');
      return;
    }
    await model.engine.capture({
      initial: {
        vendor: vendor.trim() === "" ? null : vendor.trim(),
        totalCents,
        memo: memo.trim() === "" ? null : memo.trim(),
      },
      ...(image === null ? {} : { image: { base64: image.base64, mediaType: "image/jpeg" as const } }),
    });
    setVendor("");
    setAmount("");
    setMemo("");
    setImage(null);
    await refresh(model);
    void sync(model);
  };

  const approve = async (receiptId: string, line: ScheduleFLineId) => {
    if (model === null) return;
    await model.engine.approve(receiptId, line);
    await refresh(model);
    void sync(model);
  };

  const saveBarnUrl = async (url: string) => {
    if (model === null) return;
    model.transport.url = url.trim();
    await model.store.saveSetting("barnUrl", model.transport.url);
    void sync(model);
  };

  if (model === null) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.h1}>🐴 saddlebag</Text>
        <Text style={styles.dim}>opening the saddlebag…</Text>
      </View>
    );
  }

  const netChip =
    online === false
      ? { label: "offline — stashing locally", style: styles.chipOffline }
      : syncError !== null
        ? { label: "barn unreachable", style: styles.chipOffline }
        : { label: "synced with the barn", style: styles.chipOnline };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <FlatList
        contentContainerStyle={styles.list}
        data={receipts}
        keyExtractor={(item) => item.receipt.id}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <Text style={styles.h1}>🐴 saddlebag</Text>
              <Text style={styles.dim}>{model.deviceId}</Text>
            </View>
            <View style={styles.headerRow}>
              <Text style={[styles.chip, netChip.style]}>{netChip.label}</Text>
              {pending > 0 && <Text style={[styles.chip, styles.chipPending]}>🎒 {pending} queued</Text>}
              <Pressable onPress={() => void sync(model)} style={styles.buttonGhost}>
                <Text style={styles.buttonGhostText}>Sync now</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>New expense</Text>
              <TextInput style={styles.input} placeholder="Vendor (Cenex Co-op)" placeholderTextColor="#a39a8a" value={vendor} onChangeText={setVendor} />
              <View style={styles.row}>
                <TextInput style={[styles.input, styles.inputHalf]} placeholder="Amount (312.55)" placeholderTextColor="#a39a8a" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
                <Pressable onPress={() => void pick(true)} style={styles.buttonGhost}>
                  <Text style={styles.buttonGhostText}>📷</Text>
                </Pressable>
                <Pressable onPress={() => void pick(false)} style={styles.buttonGhost}>
                  <Text style={styles.buttonGhostText}>🖼️</Text>
                </Pressable>
                {image !== null && <Image source={{ uri: image.uri }} style={styles.preview} />}
              </View>
              <TextInput style={styles.input} placeholder="Memo (diesel for the baler)" placeholderTextColor="#a39a8a" value={memo} onChangeText={setMemo} />
              <Pressable onPress={() => void stash()} style={styles.button}>
                <Text style={styles.buttonText}>Stash it — syncs when there's signal</Text>
              </Pressable>
            </View>

            <View style={styles.settingsRow}>
              <Text style={styles.dim}>barn</Text>
              <TextInput
                style={[styles.input, styles.inputBarn]}
                value={barnUrl}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setBarnUrl}
                onEndEditing={() => void saveBarnUrl(barnUrl)}
              />
            </View>
            {receipts.length === 0 && (
              <Text style={[styles.dim, styles.empty]}>Nothing stashed yet. Snap the first receipt.</Text>
            )}
          </View>
        }
        renderItem={({ item }) => <ReceiptCard item={item} onApprove={approve} />}
      />
    </View>
  );
}

function ReceiptCard({
  item,
  onApprove,
}: {
  item: LocalReceipt;
  onApprove: (receiptId: string, line: ScheduleFLineId) => void;
}) {
  const receipt = item.receipt;
  const f = receipt.fields;
  const statusStyle =
    receipt.status === "approved"
      ? styles.chipApproved
      : receipt.status === "suggested"
        ? styles.chipSuggested
        : styles.chipCaptured;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.vendor}>{f.vendor ?? "(no vendor yet)"}</Text>
        <Text style={styles.total}>{f.totalCents === null ? "—" : formatCents(f.totalCents)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={[styles.chip, statusStyle]}>{receipt.status}</Text>
        {item.pendingOps > 0 && <Text style={[styles.chip, styles.chipPending]}>🎒 {item.pendingOps}</Text>}
        {f.purchasedAt !== null && <Text style={styles.dim}>{f.purchasedAt}</Text>}
      </View>
      {f.memo !== null && <Text style={styles.memo}>📝 {f.memo}</Text>}
      {f.category !== null && <Text style={styles.memo}>📒 {scheduleFLabel(f.category)}</Text>}
      {receipt.suggestion !== null && !receipt.isApproved && (
        <View style={styles.suggestion}>
          <Text style={styles.suggestionText}>
            🤖 {scheduleFLabel(receipt.suggestion.line)} · {Math.round(receipt.suggestion.confidence * 100)}%
          </Text>
          <Text style={styles.suggestionRationale}>{receipt.suggestion.rationale}</Text>
          <Pressable onPress={() => onApprove(receipt.id, receipt.suggestion!.line)} style={styles.button}>
            <Text style={styles.buttonText}>Approve</Text>
          </Pressable>
        </View>
      )}
      {receipt.conflictLog.map((conflict, index) => (
        <Text key={index} style={styles.conflict}>
          ⚡ {conflict.field}: kept “{String(conflict.kept)}”, dropped “{String(conflict.discarded)}” from{" "}
          {conflict.discardedFrom}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: paper },
  center: { alignItems: "center", justifyContent: "center", gap: 8 },
  list: { padding: 16, paddingTop: 64, paddingBottom: 48 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" },
  h1: { fontSize: 22, fontWeight: "800", color: ink },
  dim: { color: "#6f675c", fontSize: 13 },
  empty: { textAlign: "center", marginTop: 32 },
  card: {
    backgroundColor: card,
    borderColor: ink,
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    gap: 6,
  },
  cardTitle: { fontWeight: "700", color: ink, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  vendor: { fontWeight: "700", color: ink, fontSize: 15, flexShrink: 1 },
  total: { marginLeft: "auto", color: ink, fontVariant: ["tabular-nums"], fontWeight: "600" },
  memo: { color: "#4c4438", fontSize: 13 },
  input: {
    borderWidth: 1.5,
    borderColor: ink,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: card,
    color: ink,
    fontSize: 14,
  },
  inputHalf: { flex: 1 },
  inputBarn: { flex: 1, paddingVertical: 4, fontSize: 12.5 },
  settingsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  preview: { width: 38, height: 38, borderRadius: 6, borderWidth: 1, borderColor: ink },
  button: { backgroundColor: ink, borderRadius: 8, paddingVertical: 8, alignItems: "center", marginTop: 4 },
  buttonText: { color: card, fontWeight: "700", fontSize: 13.5 },
  buttonGhost: {
    borderWidth: 1.5,
    borderColor: ink,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: card,
  },
  buttonGhostText: { color: ink, fontWeight: "700", fontSize: 13 },
  chip: {
    borderWidth: 1,
    borderColor: ink,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 2,
    fontSize: 12,
    color: ink,
    overflow: "hidden",
  },
  chipCaptured: { backgroundColor: "#eee7d9" },
  chipSuggested: { backgroundColor: "#fff3c4" },
  chipApproved: { backgroundColor: "#d7ecc8" },
  chipPending: { backgroundColor: "#e8e0f0" },
  chipOnline: { backgroundColor: "#d7ecc8" },
  chipOffline: { backgroundColor: "#f3d1c4" },
  suggestion: { backgroundColor: "#f6efdf", borderRadius: 8, padding: 9, gap: 4 },
  suggestionText: { color: ink, fontWeight: "600", fontSize: 13.5 },
  suggestionRationale: { color: "#4c4438", fontSize: 12.5 },
  conflict: { color: "#8a3b2b", fontSize: 12.5 },
});
