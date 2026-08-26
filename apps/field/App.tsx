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
        <Text style={styles.title}>saddlebag</Text>
        <Text style={styles.dim}>opening…</Text>
      </View>
    );
  }

  const netLine =
    online === false
      ? "offline — stashing locally"
      : syncError !== null
        ? "barn unreachable"
        : "synced";
  const netStyle = netLine === "synced" ? styles.ok : styles.warn;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <FlatList
        contentContainerStyle={styles.list}
        data={receipts}
        keyExtractor={(item) => item.receipt.id}
        ListHeaderComponent={
          <View>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>saddlebag</Text>
              <Text style={styles.dim}>{model.deviceId}</Text>
            </View>
            <View style={styles.rowBetween}>
              <Text style={[styles.dim, netStyle]}>
                {netLine}
                {pending > 0 ? ` · ${pending} queued` : ""}
              </Text>
              <Pressable onPress={() => void sync(model)}>
                <Text style={styles.link}>[sync]</Text>
              </Pressable>
            </View>

            <View style={styles.form}>
              <TextInput style={styles.input} placeholder="vendor" placeholderTextColor="#999" value={vendor} onChangeText={setVendor} />
              <TextInput style={styles.input} placeholder="amount (184.37)" placeholderTextColor="#999" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
              <TextInput style={styles.input} placeholder="memo" placeholderTextColor="#999" value={memo} onChangeText={setMemo} />
              <View style={styles.row}>
                <Pressable style={styles.button} onPress={() => void pick(true)}>
                  <Text style={styles.buttonText}>photo</Text>
                </Pressable>
                <Pressable style={styles.button} onPress={() => void pick(false)}>
                  <Text style={styles.buttonText}>library</Text>
                </Pressable>
                {image !== null && <Image source={{ uri: image.uri }} style={styles.preview} />}
                <View style={styles.spacer} />
                <Pressable style={[styles.button, styles.buttonMain]} onPress={() => void stash()}>
                  <Text style={[styles.buttonText, styles.buttonMainText]}>stash it</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.row}>
              <Text style={styles.dim}>barn: </Text>
              <TextInput
                style={styles.inputBarn}
                value={barnUrl}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setBarnUrl}
                onEndEditing={() => void saveBarnUrl(barnUrl)}
              />
            </View>
            {receipts.length === 0 && <Text style={[styles.dim, styles.empty]}>nothing stashed yet</Text>}
          </View>
        }
        renderItem={({ item }) => <ReceiptRow item={item} onApprove={approve} />}
      />
    </View>
  );
}

function ReceiptRow({
  item,
  onApprove,
}: {
  item: LocalReceipt;
  onApprove: (receiptId: string, line: ScheduleFLineId) => void;
}) {
  const receipt = item.receipt;
  const f = receipt.fields;
  const statusStyle =
    receipt.status === "approved" ? styles.ok : receipt.status === "suggested" ? styles.warn : styles.dim;

  return (
    <View style={styles.receiptRow}>
      <View style={styles.rowBetween}>
        <Text style={styles.vendor}>{f.vendor ?? "(no vendor)"}</Text>
        <Text style={styles.amount}>{f.totalCents === null ? "—" : formatCents(f.totalCents)}</Text>
      </View>
      <Text style={styles.dim}>
        <Text style={statusStyle}>{receipt.status}</Text>
        {item.pendingOps > 0 ? ` · ${item.pendingOps} queued` : ""}
        {f.purchasedAt === null ? "" : ` · ${f.purchasedAt}`}
        {f.memo === null ? "" : ` · ${f.memo}`}
      </Text>
      {f.category !== null && <Text style={styles.dim}>booked: {scheduleFLabel(f.category)}</Text>}
      {receipt.suggestion !== null && !receipt.isApproved && (
        <View style={styles.row}>
          <Text style={[styles.dim, styles.sug]}>
            suggests {scheduleFLabel(receipt.suggestion.line)} ({Math.round(receipt.suggestion.confidence * 100)}
            %)
          </Text>
          <Pressable style={styles.button} onPress={() => onApprove(receipt.id, receipt.suggestion!.line)}>
            <Text style={styles.buttonText}>approve</Text>
          </Pressable>
        </View>
      )}
      {receipt.conflictLog.map((conflict, index) => (
        <Text key={index} style={styles.conflict}>
          conflict on {conflict.field}: kept "{String(conflict.kept)}", dropped "{String(conflict.discarded)}"
          ({conflict.discardedFrom})
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  center: { alignItems: "center", justifyContent: "center", gap: 4 },
  list: { padding: 14, paddingTop: 60, paddingBottom: 40 },
  title: { fontSize: 17, fontWeight: "700", color: "#222" },
  dim: { color: "#666", fontSize: 13 },
  ok: { color: "#1a7f37" },
  warn: { color: "#9a6700" },
  link: { color: "#24578f", fontSize: 13 },
  empty: { marginTop: 24, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" },
  rowBetween: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 2 },
  spacer: { flex: 1 },
  form: { borderWidth: 1, borderColor: "#cfcfcf", padding: 8, marginTop: 10, gap: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#cfcfcf",
    paddingHorizontal: 7,
    paddingVertical: 5,
    fontSize: 13,
    color: "#222",
    backgroundColor: "#fff",
  },
  inputBarn: {
    flex: 1,
    borderBottomWidth: 1,
    borderColor: "#cfcfcf",
    paddingVertical: 2,
    fontSize: 12,
    color: "#666",
  },
  preview: { width: 30, height: 30, borderWidth: 1, borderColor: "#cfcfcf" },
  button: { borderWidth: 1, borderColor: "#999", backgroundColor: "#f6f6f6", paddingHorizontal: 9, paddingVertical: 3 },
  buttonText: { fontSize: 13, color: "#222" },
  buttonMain: { backgroundColor: "#222", borderColor: "#222" },
  buttonMainText: { color: "#fff" },
  vendor: { fontWeight: "700", color: "#222", fontSize: 14, flexShrink: 1 },
  amount: { color: "#222", fontVariant: ["tabular-nums"], fontSize: 14 },
  sug: { flexShrink: 1 },
  receiptRow: { borderTopWidth: 1, borderColor: "#e2e2e2", paddingVertical: 8, marginTop: 8, gap: 2 },
  conflict: { color: "#b3261e", fontSize: 12 },
});
