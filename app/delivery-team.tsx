import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { getRoleTheme } from '@/assets/constants/roleTheme';
import {
  effectiveDesignation,
  findMyWorkerRow,
} from '@/src/utils/workerManagement';
import { fetchSheetRows, type SheetRow } from '@/src/utils/sheets';
import { openDirectionsTo } from '@/src/utils/routePlanner';
import {
  buildDistribution,
  findPlanForWorker,
  formatDeliveryEta,
  loadDeliveryLocations,
  workerSpotsFromRows,
  type DeliveryLocationRecord,
  type WorkerDeliveryPlan,
} from '@/src/utils/deliverySpots';

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

export default function DeliveryTeamScreen() {
  const user = useSelector((state: RootState) => state.user);
  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';

  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [locations, setLocations] = useState<DeliveryLocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const myRow = useMemo(
    () =>
      findMyWorkerRow(
        workers,
        user.workerProfile?.workerId,
        user.email || user.workerProfile?.email
      ),
    [workers, user.workerProfile?.workerId, user.email, user.workerProfile?.email]
  );
  const designation = effectiveDesignation(
    user.profile?.designation || user.designation,
    myRow
  );
  const isAdmin = designation === 'admin';
  const isManager = designation === 'manager';
  const canTrackTeam = isAdmin || isManager;
  const theme = getRoleTheme(designation, !canTrackTeam);

  const spots = useMemo(() => workerSpotsFromRows(workers), [workers]);
  const distribution = useMemo(
    () => buildDistribution(locations, spots),
    [locations, spots]
  );
  const myPlan = useMemo(
    () =>
      findPlanForWorker(
        distribution,
        user.workerProfile?.workerId || myRow?.WorkerID,
        user.name || user.workerProfile?.name
      ),
    [
      distribution,
      user.workerProfile?.workerId,
      user.workerProfile?.name,
      myRow?.WorkerID,
      user.name,
    ]
  );

  const visiblePlans = useMemo(() => {
    if (canTrackTeam) {
      return distribution.plans;
    }
    return myPlan ? [myPlan] : [];
  }, [canTrackTeam, distribution.plans, myPlan]);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!sheetId) {
        setLoading(false);
        return;
      }
      if (showSpinner) setRefreshing(true);
      try {
        const [rows, deliveryLocations] = await Promise.all([
          fetchSheetRows(sheetId, 'Workers').catch(() => [] as SheetRow[]),
          loadDeliveryLocations(sheetId),
        ]);
        setWorkers(rows);
        setLocations(deliveryLocations);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [sheetId]
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const navigate = async (plan: WorkerDeliveryPlan) => {
    if (!plan.current) return;
    try {
      await openDirectionsTo(plan.current, plan.worker.spot);
    } catch {
      Alert.alert('Could not open Maps', 'Install Google Maps and try again.');
    }
  };

  const totalActive = visiblePlans.reduce(
    (sum, plan) => sum + plan.pending.length,
    0
  );
  const totalDone = visiblePlans.reduce(
    (sum, plan) => sum + plan.delivered.length,
    0
  );
  const teamEta = visiblePlans.reduce(
    (longest, plan) => Math.max(longest, plan.estimatedMinutes),
    0
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.headerBg }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.headerText }]}>
            {canTrackTeam ? 'Delivery tracking' : 'My deliveries'}
          </Text>
          <Text style={[styles.subtitle, { color: theme.headerMuted }]}>
            {canTrackTeam
              ? 'Current order, remaining deliveries and completed work'
              : 'Assigned by spot · estimated time updates as you deliver'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => void load(true)}
          disabled={refreshing}
          accessibilityLabel="Refresh delivery tracking"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.headerText} />
          ) : (
            <MaterialCommunityIcons
              name="refresh"
              size={20}
              color={theme.headerText}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => router.push('/delivery-locations')}
          accessibilityLabel="Delivery locations"
        >
          <MaterialCommunityIcons
            name="map-marker-multiple-outline"
            size={20}
            color={theme.headerText}
          />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={styles.loadingText}>Loading delivery tracking…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.statsCard}>
            <View style={styles.statBlock}>
              <Text style={styles.statValue}>{visiblePlans.length}</Text>
              <Text style={styles.statLabel}>
                {canTrackTeam ? 'Employees' : 'Me'}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBlock}>
              <Text style={styles.statValue}>{totalActive}</Text>
              <Text style={styles.statLabel}>Remaining</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBlock}>
              <Text style={styles.statValue}>{totalDone}</Text>
              <Text style={styles.statLabel}>Delivered</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBlock}>
              <Text style={styles.statValue}>
                {teamEta > 0 ? formatDeliveryEta(teamEta) : '—'}
              </Text>
              <Text style={styles.statLabel}>Longest ETA</Text>
            </View>
          </View>

          {distribution.unassigned.length > 0 && canTrackTeam && (
            <View style={styles.warningCard}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={18}
                color="#B45309"
              />
              <Text style={styles.warningText}>
                {distribution.unassigned.length} address
                {distribution.unassigned.length === 1 ? '' : 'es'} are waiting
                for an employee spot. Set spots in Delivery spots.
              </Text>
            </View>
          )}

          {visiblePlans.length === 0 && (
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons
                name={canTrackTeam ? 'account-group-outline' : 'map-marker-off-outline'}
                size={30}
                color="#94A3B8"
              />
              <Text style={styles.emptyText}>
                {canTrackTeam
                  ? 'No employee spots are set yet. Open Delivery spots and set a base location for each employee.'
                  : 'Your manager has not set your delivery spot yet. Ask them to set it, then deliveries around it will appear here.'}
              </Text>
              <TouchableOpacity
                style={[styles.emptyButton, { backgroundColor: theme.accent }]}
                onPress={() => router.push('/delivery-locations')}
              >
                <Text style={styles.emptyButtonText}>
                  {canTrackTeam ? 'Set employee spots' : 'View delivery spots'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {visiblePlans.map((plan) => {
            const isOpen = expanded === plan.worker.workerId;
            const total = plan.pending.length + plan.delivered.length;
            const percent =
              total > 0 ? Math.round((plan.delivered.length / total) * 100) : 0;
            return (
              <View
                key={plan.worker.workerId}
                style={[styles.planCard, { borderColor: theme.accentBorder }]}
              >
                <View style={styles.planTop}>
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: theme.accentSoft },
                    ]}
                  >
                    <Text
                      style={[styles.avatarText, { color: theme.accentDark }]}
                    >
                      {plan.worker.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.planInfo}>
                    <Text style={styles.planName} numberOfLines={1}>
                      {plan.worker.name}
                    </Text>
                    <Text style={styles.planDesignation} numberOfLines={1}>
                      {plan.worker.designation || 'employee'} ·{' '}
                      {plan.worker.spot?.address || 'No spot'}
                    </Text>
                  </View>
                  {!!plan.current && (
                    <TouchableOpacity
                      style={[styles.navigateButton, { backgroundColor: theme.accent }]}
                      onPress={() => void navigate(plan)}
                    >
                      <MaterialCommunityIcons
                        name="navigation"
                        size={16}
                        color="#fff"
                      />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.currentBox}>
                  <MaterialCommunityIcons
                    name={
                      plan.current
                        ? 'navigation-variant-outline'
                        : plan.worker.spot
                        ? 'check-circle-outline'
                        : 'map-marker-off-outline'
                    }
                    size={16}
                    color={
                      plan.current
                        ? theme.accentDark
                        : plan.worker.spot
                        ? '#15803D'
                        : '#94A3B8'
                    }
                  />
                  <View style={styles.currentInfo}>
                    <Text style={styles.currentLabel}>
                      {plan.current
                        ? 'Current order'
                        : plan.worker.spot
                        ? 'All done'
                        : 'No spot set'}
                    </Text>
                    <Text style={styles.currentAddress} numberOfLines={2}>
                      {plan.current
                        ? plan.current.address
                        : plan.worker.spot
                        ? 'No pending deliveries for this spot'
                        : 'Set a spot to receive deliveries automatically'}
                    </Text>
                  </View>
                </View>

                <View style={styles.planStats}>
                  <View style={styles.planStat}>
                    <Text style={styles.planStatValue}>{plan.pending.length}</Text>
                    <Text style={styles.planStatLabel}>Remaining</Text>
                  </View>
                  <View style={styles.planStatDivider} />
                  <View style={styles.planStat}>
                    <Text style={[styles.planStatValue, { color: '#15803D' }]}>
                      {plan.delivered.length}
                    </Text>
                    <Text style={styles.planStatLabel}>Delivered</Text>
                  </View>
                  <View style={styles.planStatDivider} />
                  <View style={styles.planStat}>
                    <Text style={styles.planStatValue}>
                      {formatDeliveryEta(plan.estimatedMinutes)}
                    </Text>
                    <Text style={styles.planStatLabel}>Est. time</Text>
                  </View>
                  <View style={styles.planStatDivider} />
                  <View style={styles.planStat}>
                    <Text style={styles.planStatValue}>
                      {formatDistance(plan.totalDistanceMeters)}
                    </Text>
                    <Text style={styles.planStatLabel}>Distance</Text>
                  </View>
                </View>

                <View style={styles.progressHeader}>
                  <Text style={styles.progressText}>
                    {plan.delivered.length} of {total} completed
                  </Text>
                  <Text style={[styles.progressPercent, { color: theme.accentDark }]}>
                    {percent}%
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${percent}%`, backgroundColor: theme.accent },
                    ]}
                  />
                </View>

                {total > 0 && (
                  <TouchableOpacity
                    style={styles.expandButton}
                    onPress={() =>
                      setExpanded(isOpen ? null : plan.worker.workerId)
                    }
                  >
                    <Text style={[styles.expandText, { color: theme.accent }]}>
                      {isOpen ? 'Hide deliveries' : 'Show all deliveries'}
                    </Text>
                    <MaterialCommunityIcons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={theme.accent}
                    />
                  </TouchableOpacity>
                )}

                {isOpen && (
                  <View style={styles.deliveryList}>
                    {plan.pending.map((location, index) => (
                      <View key={location.id} style={styles.deliveryRow}>
                        <View
                          style={[
                            styles.deliverySerial,
                            { backgroundColor: theme.accentSoft },
                          ]}
                        >
                          <Text
                            style={[
                              styles.deliverySerialText,
                              { color: theme.accent },
                            ]}
                          >
                            {index + 1}
                          </Text>
                        </View>
                        <View style={styles.deliveryInfo}>
                          <Text style={styles.deliveryAddress} numberOfLines={2}>
                            {location.address}
                          </Text>
                          {!!(location.contactName || location.phone) && (
                            <Text style={styles.deliveryMeta} numberOfLines={1}>
                              {[location.contactName, location.phone]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          )}
                        </View>
                        <View style={styles.deliveryRight}>
                          <Text style={styles.deliveryEta}>
                            ETA {formatDeliveryEta(plan.etas[location.id] || 0)}
                          </Text>
                          {!!location.orderCount && (
                            <Text style={styles.deliveryOrders}>
                              {location.orderCount} order
                              {location.orderCount === 1 ? '' : 's'}
                            </Text>
                          )}
                        </View>
                      </View>
                    ))}
                    {plan.pending.length === 0 && (
                      <Text style={styles.deliveryEmpty}>
                        Nothing left for this spot.
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          <View style={styles.footerNote}>
            <MaterialCommunityIcons
              name="information-outline"
              size={13}
              color="#94A3B8"
            />
            <Text style={styles.footerNoteText}>
              Estimated time includes driving between stops and about 4 minutes
              at every door. It updates whenever a delivery is completed.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  header: {
    paddingTop: 58,
    paddingBottom: 18,
    paddingHorizontal: 18,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginRight: 10,
  },
  headerText: { flex: 1 },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginLeft: 8,
  },
  title: { fontSize: 21, fontWeight: '800' },
  subtitle: { fontSize: 11, marginTop: 3 },
  content: { padding: 16, paddingBottom: 110 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 10, fontSize: 12, color: '#64748B' },

  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
    marginBottom: 14,
  },
  statBlock: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 15.5, fontWeight: '800', color: '#1E293B' },
  statLabel: { fontSize: 9.5, color: '#94A3B8', marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: '#F1F5F9' },

  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 10,
    marginBottom: 12,
  },
  warningText: {
    flex: 1,
    fontSize: 10,
    color: '#92400E',
    marginLeft: 7,
    lineHeight: 14,
  },

  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
  },
  emptyText: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 16,
  },
  emptyButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 14,
  },
  emptyButtonText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },

  planCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
    marginBottom: 10,
  },
  planTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '800' },
  planInfo: { flex: 1, marginLeft: 10 },
  planName: { fontSize: 14, fontWeight: '800', color: '#1E293B' },
  planDesignation: { fontSize: 10, color: '#64748B', marginTop: 2 },
  navigateButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  currentBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 11,
    padding: 9,
    marginTop: 11,
  },
  currentInfo: { flex: 1, marginLeft: 7 },
  currentLabel: {
    fontSize: 8.5,
    color: '#94A3B8',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  currentAddress: {
    fontSize: 11.5,
    color: '#1E293B',
    fontWeight: '700',
    marginTop: 1,
  },

  planStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 11,
  },
  planStat: { flex: 1, alignItems: 'center' },
  planStatValue: { fontSize: 12.5, fontWeight: '800', color: '#1E293B' },
  planStatLabel: { fontSize: 8.5, color: '#94A3B8', marginTop: 2 },
  planStatDivider: { width: 1, height: 24, backgroundColor: '#F1F5F9' },

  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 11,
  },
  progressText: { fontSize: 9.5, color: '#64748B', fontWeight: '700' },
  progressPercent: { fontSize: 9.5, fontWeight: '800' },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
    marginTop: 5,
  },
  progressFill: { height: 6, borderRadius: 3 },

  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
  },
  expandText: { fontSize: 10.5, fontWeight: '800', marginRight: 3 },

  deliveryList: { marginTop: 8 },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  deliverySerial: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deliverySerialText: { fontSize: 10, fontWeight: '800' },
  deliveryInfo: { flex: 1, marginLeft: 8 },
  deliveryAddress: { fontSize: 11, fontWeight: '700', color: '#334155' },
  deliveryMeta: { fontSize: 9, color: '#94A3B8', marginTop: 1 },
  deliveryRight: { alignItems: 'flex-end', marginLeft: 8 },
  deliveryEta: { fontSize: 9, fontWeight: '800', color: '#64748B' },
  deliveryOrders: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#94A3B8',
    marginTop: 2,
  },
  deliveryEmpty: {
    fontSize: 10,
    color: '#94A3B8',
    textAlign: 'center',
    paddingVertical: 8,
  },

  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    marginTop: 8,
  },
  footerNoteText: {
    flex: 1,
    fontSize: 9.5,
    color: '#94A3B8',
    lineHeight: 14,
    marginLeft: 5,
  },
});
