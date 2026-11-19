import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { getRoleTheme } from '@/assets/constants/roleTheme';
import {
  fetchSheetRows,
  getGoogleAccessToken,
  type SheetRow,
} from '@/src/utils/sheets';
import {
  effectiveDesignation,
  findMyWorkerRow,
  rowHasEditAccess,
  rowHasReadAccess,
  setWorkerEditAccess,
  setWorkerReadAccess,
  updateWorkerFields,
} from '@/src/utils/workerManagement';
import { computeWorkerPerformance } from '@/src/utils/attendanceStats';
import { localDateString } from '@/src/utils/attendance';
import {
  DEFAULT_COMPANY_SETTINGS,
  readCompanySettings,
  type CompanySettings,
} from '@/src/utils/settings';
import { notifyAdminOfEdit } from '@/src/utils/editAccess';

export default function WorkerDetailsScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const user = useSelector((state: RootState) => state.user);

  const workerId = params.id as string;
  const editModeParam = params.editMode === 'true';

  const [isEditing, setIsEditing] = useState(editModeParam);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [payPerHour, setPayPerHour] = useState('0');
  const [workerName, setWorkerName] = useState('');
  const [workerPhone, setWorkerPhone] = useState('');
  const [workerEmail, setWorkerEmail] = useState('');
  const [workerBio, setWorkerBio] = useState('');
  const [workerDesignation, setWorkerDesignation] = useState('worker');
  const [clockings, setClockings] = useState<SheetRow[]>([]);
  const [allClockings, setAllClockings] = useState<SheetRow[]>([]);
  const [workerRows, setWorkerRows] = useState<SheetRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [companySettings, setCompanySettings] = useState<CompanySettings>(
    DEFAULT_COMPANY_SETTINGS
  );

  const currentWorkerId = user.workerProfile?.workerId;
  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';

  const workerRow = useMemo(
    () =>
      workerRows.find(
        (row) =>
          row.WorkerID === workerId ||
          (!!user.workerProfile?.workerId && row.WorkerID === user.workerProfile.workerId && workerId === 'me')
      ),
    [workerRows, workerId, user.workerProfile?.workerId]
  );
  const myRow = useMemo(
    () =>
      findMyWorkerRow(
        workerRows,
        currentWorkerId,
        user.email || user.workerProfile?.email
      ),
    [workerRows, currentWorkerId, user.email, user.workerProfile?.email]
  );

  const designation = effectiveDesignation(
    user.profile?.designation || user.designation,
    myRow
  );
  const isAdmin = designation === 'admin';
  const isManager = designation === 'manager';
  const isEmployeeRole = !isAdmin && !isManager;
  const theme = getRoleTheme(designation, isEmployeeRole);
  const targetHasAccess = rowHasEditAccess(workerRow);
  const hasEditAccess = rowHasEditAccess(myRow);
  const hasReadAccess = rowHasReadAccess(myRow);
  const canEdit = isAdmin || hasEditAccess;
  const canReadAll = isAdmin || isManager || hasReadAccess || hasEditAccess;
  const dataReady = workerRows.length > 0;

  useEffect(() => {
    // Wait for Workers to load: a link-joined manager starts with
    // designation "worker" until their actual row is resolved.
    if (!dataReady) return;
    if (
      isEmployeeRole &&
      !canReadAll &&
      workerId !== currentWorkerId &&
      workerId !== 'me'
    ) {
      Alert.alert('Access Denied', 'Ask the admin to grant read access.');
      router.back();
    }
  }, [
    workerId,
    currentWorkerId,
    isEmployeeRole,
    canReadAll,
    dataReady,
    router,
  ]);

  const fetchData = React.useCallback(async () => {
    if (!sheetId) return;

    try {
      const [clockingRows, allWorkers, settings] = await Promise.all([
        fetchSheetRows(sheetId, 'Clockings'),
        fetchSheetRows(sheetId, 'Workers'),
        readCompanySettings(sheetId),
      ]);

      const resolvedId =
        workerId === 'me' ? user.workerProfile?.workerId : workerId;
      const now = new Date();
      const month = now.getMonth();
      const year = now.getFullYear();

      setWorkerRows(allWorkers);
      setAllClockings(clockingRows);
      setCompanySettings(settings);
      setClockings(
        clockingRows.filter((c) => {
          const date = new Date(c.Date);
          return (
            c.WorkerID === resolvedId &&
            date.getMonth() === month &&
            date.getFullYear() === year
          );
        })
      );
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  }, [workerId, sheetId, user.workerProfile?.workerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (workerRow?.PayPerHour) {
      setPayPerHour(workerRow.PayPerHour);
    }
    setWorkerName(workerRow?.Name || '');
    setWorkerPhone(workerRow?.Phone || '');
    setWorkerEmail(workerRow?.Email || '');
    setWorkerBio(workerRow?.Bio || '');
    setWorkerDesignation(workerRow?.Designation || 'worker');
  }, [workerRow?.PayPerHour, workerRow?.Name, workerRow?.Phone, workerRow?.Email, workerRow?.Bio, workerRow?.Designation]);

  const resolvedId =
    workerId === 'me' ? user.workerProfile?.workerId : workerId;

  const monthStart = useMemo(() => {
    const now = new Date();
    return localDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  }, []);

  const performance = useMemo(
    () =>
      computeWorkerPerformance({
        clockings: allClockings,
        workerId: resolvedId || '',
        monthStart,
        officeStart: companySettings.officeStart,
        dailyWorkHours: companySettings.dailyWorkHours,
        payPerHour: parseFloat(payPerHour || '0') || 0,
      }),
    [
      allClockings,
      resolvedId,
      monthStart,
      companySettings.officeStart,
      companySettings.dailyWorkHours,
      payPerHour,
    ]
  );

  const recentClockings = useMemo(() => {
    if (!resolvedId) return [];
    const sorted = allClockings
      .filter((row) => row.WorkerID === resolvedId && row.ClockIn)
      .sort(
        (a, b) =>
          (b.Date || '').localeCompare(a.Date || '') ||
          Number(b._row || 0) - Number(a._row || 0)
      );
    const lastThreeDays = Array.from(
      new Set(sorted.map((row) => (row.Date || '').slice(0, 10)))
    ).slice(0, 3);
    return sorted.filter((row) =>
      lastThreeDays.includes((row.Date || '').slice(0, 10))
    );
  }, [allClockings, resolvedId]);

  const totalHours = useMemo(() => {
    return clockings.reduce((sum, c) => sum + parseFloat(c.HoursWorked as string || '0'), 0);
  }, [clockings]);

  const totalPay = useMemo(() => {
    return Math.round((totalHours * parseFloat(payPerHour as string || '0')) * 100) / 100;
  }, [totalHours, payPerHour]);

  const totalBreakTime = useMemo(() => {
    return clockings.reduce((sum, c) => sum + parseFloat(c.BreakMins as string || '0'), 0);
  }, [clockings]);

  const avgHoursPerDay = useMemo(() => {
    return clockings.length > 0 ? totalHours / clockings.length : 0;
  }, [totalHours, clockings]);

  const handleSavePayRate = async () => {
    if (!canEdit) {
      Alert.alert('Read only', 'Ask an admin to grant edit access.');
      return;
    }
    if (!sheetId) return;
    setSaving(true);
    try {
      const token = await getGoogleAccessToken(true);
      const resolvedId =
        workerId === 'me' ? user.workerProfile?.workerId : workerId;
      await updateWorkerFields(
        sheetId,
        token,
        { workerId: resolvedId || workerRow?.WorkerID, email: workerRow?.Email },
        {
          Name: workerName.trim(),
          Phone: workerPhone.trim(),
          Email: workerEmail.trim(),
          Bio: workerBio.trim(),
          Designation: workerDesignation,
          PayPerHour: payPerHour.trim() || '0',
        }
      );
      setWorkerRows((prev) =>
        prev.map((row) =>
          row.WorkerID === (resolvedId || workerRow?.WorkerID)
            ? {
                ...row,
                Name: workerName.trim(),
                Phone: workerPhone.trim(),
                Email: workerEmail.trim(),
                Bio: workerBio.trim(),
                Designation: workerDesignation,
                PayPerHour: payPerHour.trim() || '0',
              }
            : row
        )
      );
      setIsEditing(false);

      if (!isAdmin) {
        await notifyAdminOfEdit({
          sheetId,
          token,
          actorWorkerId: currentWorkerId || myRow?.WorkerID || '',
          actorName: myRow?.Name || user.name || 'A teammate',
          targetName: workerRow?.Name || 'a worker',
          action: 'updated worker details',
        });
      }

      Alert.alert(
        'Saved',
        isAdmin
          ? 'Worker details updated.'
          : 'Saved. The admin has been notified.'
      );
    } catch (error: any) {
      Alert.alert('Unable to save', error?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAccess = () => {
    if (!isAdmin || !workerRow) return;
    const enabled = targetHasAccess;
    Alert.alert(
      enabled ? 'Revoke edit access?' : 'Give edit access?',
      enabled
        ? `${workerRow.Name} will no longer be able to edit data.`
        : `${workerRow.Name} will be able to edit data in the app once. Clock-in/out stays enabled because the sheet is shared as Editor.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: enabled ? 'Revoke' : 'Give access',
          style: enabled ? 'destructive' : 'default',
          onPress: async () => {
            setAccessBusy(true);
            try {
              const token = await getGoogleAccessToken(true);
              if (!token) throw new Error('Sign in with Google to manage access.');
              const result = await setWorkerEditAccess(
                sheetId,
                token,
                { workerId: workerRow.WorkerID, email: workerRow.Email },
                !enabled
              );
              setWorkerRows((prev) =>
                prev.map((row) =>
                  row.WorkerID === workerRow.WorkerID
                    ? { ...row, EditAccess: enabled ? 'false' : 'true' }
                    : row
                )
              );
              if (!result.driveUpdated) {
                Alert.alert(
                  'Sheet updated',
                  `Access flag saved, but Drive sharing could not be updated${
                    result.driveError ? `: ${result.driveError}` : '.'
                  }`
                );
              }
            } catch (error: any) {
              Alert.alert('Access update failed', error?.message || 'Try again.');
            } finally {
              setAccessBusy(false);
            }
          },
        },
      ]
    );
  };

  const handleToggleReadAccess = () => {
    if (!isAdmin || !workerRow) return;
    const enabled = rowHasReadAccess(workerRow);
    Alert.alert(
      enabled ? 'Revoke read access?' : 'Give read access?',
      enabled
        ? `${workerRow.Name} will no longer be able to view other workers' details.`
        : `${workerRow.Name} will be able to view every worker's details (read only).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: enabled ? 'Revoke' : 'Give access',
          style: enabled ? 'destructive' : 'default',
          onPress: async () => {
            setAccessBusy(true);
            try {
              const token = await getGoogleAccessToken(true);
              if (!token) {
                throw new Error('Sign in with Google to manage access.');
              }
              await setWorkerReadAccess(
                sheetId,
                token,
                { workerId: workerRow.WorkerID, email: workerRow.Email },
                !enabled
              );
              setWorkerRows((prev) =>
                prev.map((row) =>
                  row.WorkerID === workerRow.WorkerID
                    ? { ...row, ReadAccess: enabled ? 'false' : 'true' }
                    : row
                )
              );
            } catch (error: any) {
              Alert.alert('Access update failed', error?.message || 'Try again.');
            } finally {
              setAccessBusy(false);
            }
          },
        },
      ]
    );
  };

  const renderClockingItem = ({ item }: { item: SheetRow }) => (
    <View style={styles.recordCard}>
      <View style={styles.recordHeader}>
        <Text style={styles.recordDate}>{item.Date}</Text>
        <View style={styles.hoursBadge}>
          <Text style={styles.hoursText}>{parseFloat(item.HoursWorked as string || '0').toFixed(2)} hrs</Text>
        </View>
      </View>
      <View style={styles.recordDetails}>
        <View style={styles.timeRow}>
          <View style={styles.timeItem}>
            <MaterialCommunityIcons name="login" size={16} color="#4CAF50" />
            <Text style={styles.timeLabel}>In:</Text>
            <Text style={styles.timeValue}>{item.ClockIn || '--:--'}</Text>
          </View>
          <View style={styles.timeItem}>
            <MaterialCommunityIcons name="logout" size={16} color="#F44336" />
            <Text style={styles.timeLabel}>Out:</Text>
            <Text style={styles.timeValue}>{item.ClockOut || '--:--'}</Text>
          </View>
        </View>
        {parseFloat(item.BreakMins as string || '0') > 0 && (
          <View style={styles.breakRow}>
            <MaterialCommunityIcons name="coffee" size={16} color="#FF9800" />
            <Text style={styles.breakLabel}>Break:</Text>
            <Text style={styles.breakValue}>{item.BreakMins} mins</Text>
          </View>
        )}
        <View style={styles.dayTotalRow}>
          <Text style={styles.dayTotalLabel}>Day Total:</Text>
          <Text style={styles.dayTotalValue}>${item.DayTotal || '0.00'}</Text>
        </View>
      </View>
    </View>
  );

  const displayName =
    workerRow?.Name ||
    (workerId === 'me' ? user.name || 'You' : `Worker ${workerId}`);
  const displayDesignation =
    workerRow?.Designation || user.workerProfile?.designation || 'Employee';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.workerName}>{displayName}</Text>
          <Text style={styles.workerDesignation}>{displayDesignation}</Text>
        </View>
        {canEdit && (
          <TouchableOpacity style={styles.editButton} onPress={() => setIsEditing(!isEditing)}>
            <MaterialCommunityIcons
              name={isEditing ? 'check' : 'pencil'}
              size={24}
              color={theme.accent}
            />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.content}>
        <View style={styles.analyticsContainer}>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="clock-outline" size={28} color="#00af5bff" />
            <Text style={styles.statValue}>{totalHours.toFixed(1)}</Text>
            <Text style={styles.statLabel}>Total Hours</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="cash" size={28} color="#00af5bff" />
            <Text style={styles.statValue}>${totalPay.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Total Pay</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="calendar-check" size={28} color="#00af5bff" />
            <Text style={styles.statValue}>{performance.attendanceRate}%</Text>
            <Text style={styles.statLabel}>Attendance</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.infoHeaderRow}>
            <Text style={styles.sectionTitle}>Worker profile</Text>
            {isAdmin ? (
              <TouchableOpacity
                style={[
                  styles.accessBadge,
                  {
                    backgroundColor: targetHasAccess ? '#DCFCE7' : '#F1F5F9',
                  },
                ]}
                onPress={handleToggleAccess}
                disabled={accessBusy}
                accessibilityRole="button"
                accessibilityLabel="Toggle edit access for this worker"
              >
                <MaterialCommunityIcons
                  name={
                    targetHasAccess ? 'shield-check' : 'shield-lock-outline'
                  }
                  size={13}
                  color={targetHasAccess ? '#15803D' : '#64748B'}
                />
                <Text
                  style={[
                    styles.accessBadgeText,
                    { color: targetHasAccess ? '#15803D' : '#64748B' },
                  ]}
                >
                  {targetHasAccess ? 'Edit access' : 'Read only'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View
                style={[
                  styles.accessBadge,
                  {
                    backgroundColor: canEdit ? '#DCFCE7' : '#F1F5F9',
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={canEdit ? 'shield-check' : 'shield-lock-outline'}
                  size={13}
                  color={canEdit ? '#15803D' : '#64748B'}
                />
                <Text
                  style={[
                    styles.accessBadgeText,
                    { color: canEdit ? '#15803D' : '#64748B' },
                  ]}
                >
                  {canEdit ? 'Edit access' : 'Read only'}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.profileCard}>
            {isEditing && canEdit ? (
              <>
                <Text style={styles.editLabel}>Name</Text>
                <TextInput
                  style={styles.profileInput}
                  value={workerName}
                  onChangeText={setWorkerName}
                  placeholder="Full name"
                  placeholderTextColor="#94A3B8"
                />
                <Text style={styles.editLabel}>Phone</Text>
                <TextInput
                  style={styles.profileInput}
                  value={workerPhone}
                  onChangeText={setWorkerPhone}
                  keyboardType="phone-pad"
                  placeholder="Phone number"
                  placeholderTextColor="#94A3B8"
                />
                <Text style={styles.editLabel}>Email</Text>
                <TextInput
                  style={styles.profileInput}
                  value={workerEmail}
                  onChangeText={setWorkerEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="Email address"
                  placeholderTextColor="#94A3B8"
                />
                <Text style={styles.editLabel}>Bio</Text>
                <TextInput
                  style={[styles.profileInput, styles.profileInputMultiline]}
                  value={workerBio}
                  onChangeText={setWorkerBio}
                  multiline
                  placeholder="Short bio visible to the team"
                  placeholderTextColor="#94A3B8"
                />
                <Text style={styles.editLabel}>Designation</Text>
                {isAdmin ? (
                  <>
                    <TouchableOpacity
                      style={styles.dropdown}
                      onPress={() => setRoleDropdownOpen((open) => !open)}
                    >
                      <Text style={styles.dropdownText}>
                        {workerDesignation === 'manager'
                          ? 'Manager'
                          : workerDesignation === 'admin'
                          ? 'Admin'
                          : 'Employee'}
                      </Text>
                      <MaterialCommunityIcons
                        name={roleDropdownOpen ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color="#64748B"
                      />
                    </TouchableOpacity>
                    {roleDropdownOpen && (
                      <View style={styles.dropdownMenu}>
                        {['worker', 'manager', 'admin'].map((role) => {
                          const active = workerDesignation === role;
                          return (
                            <TouchableOpacity
                              key={role}
                              style={styles.dropdownOption}
                              onPress={() => {
                                setWorkerDesignation(role);
                                setRoleDropdownOpen(false);
                              }}
                            >
                              <Text
                                style={[
                                  styles.dropdownOptionText,
                                  active && {
                                    color: theme.accent,
                                    fontWeight: '800',
                                  },
                                ]}
                              >
                                {role === 'worker'
                                  ? 'Employee'
                                  : role === 'manager'
                                  ? 'Manager'
                                  : 'Admin'}
                              </Text>
                              {active && (
                                <MaterialCommunityIcons
                                  name="check"
                                  size={16}
                                  color={theme.accent}
                                />
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </>
                ) : (
                  <Text style={styles.profileLineValue}>
                    {workerDesignation}
                  </Text>
                )}
              </>
            ) : (
              <>
                <View style={styles.profileLine}>
                  <MaterialCommunityIcons name="email-outline" size={16} color="#64748B" />
                  <Text style={styles.profileLineLabel}>Email</Text>
                  <Text style={styles.profileLineValue}>
                    {workerRow?.Email || 'Not set'}
                  </Text>
                </View>
                <View style={styles.profileLine}>
                  <MaterialCommunityIcons name="phone-outline" size={16} color="#64748B" />
                  <Text style={styles.profileLineLabel}>Phone</Text>
                  <Text style={styles.profileLineValue}>
                    {workerRow?.Phone || 'Not set'}
                  </Text>
                </View>
                <View style={styles.profileLine}>
                  <MaterialCommunityIcons name="briefcase-outline" size={16} color="#64748B" />
                  <Text style={styles.profileLineLabel}>Role</Text>
                  <Text style={styles.profileLineValue}>{displayDesignation}</Text>
                </View>
                <View style={styles.profileLine}>
                  <MaterialCommunityIcons name="text-account" size={16} color="#64748B" />
                  <Text style={styles.profileLineLabel}>Bio</Text>
                  <Text style={styles.profileLineValue}>
                    {workerRow?.Bio || 'No bio added yet'}
                  </Text>
                </View>
              </>
            )}

            {isEditing && canEdit && (
              <TouchableOpacity
                style={[styles.savePayButton, { backgroundColor: theme.accent }]}
                onPress={handleSavePayRate}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.savePayButtonText}>Save worker details</Text>
                )}
              </TouchableOpacity>
            )}

            {isAdmin && workerRow && (
              <TouchableOpacity
                style={[
                  styles.accessAction,
                  {
                    backgroundColor: rowHasReadAccess(workerRow)
                      ? '#FEF2F2'
                      : theme.accentSoft,
                    borderColor: rowHasReadAccess(workerRow)
                      ? '#FECACA'
                      : theme.accentBorder,
                  },
                ]}
                onPress={handleToggleReadAccess}
                disabled={accessBusy}
              >
                <MaterialCommunityIcons
                  name={
                    rowHasReadAccess(workerRow)
                      ? 'book-open-variant'
                      : 'book-open-outline'
                  }
                  size={16}
                  color={rowHasReadAccess(workerRow) ? '#B91C1C' : theme.accentDark}
                />
                <Text
                  style={[
                    styles.accessActionText,
                    {
                      color: rowHasReadAccess(workerRow)
                        ? '#B91C1C'
                        : theme.accentDark,
                    },
                  ]}
                >
                  {rowHasReadAccess(workerRow)
                    ? 'Revoke read access'
                    : 'Give read access'}
                </Text>
              </TouchableOpacity>
            )}

            {isAdmin && workerRow && (
              <TouchableOpacity
                style={[
                  styles.accessAction,
                  {
                    backgroundColor: targetHasAccess ? '#FEF2F2' : theme.accentSoft,
                    borderColor: targetHasAccess ? '#FECACA' : theme.accentBorder,
                  },
                ]}
                onPress={handleToggleAccess}
                disabled={accessBusy}
              >
                {accessBusy ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name={targetHasAccess ? 'pencil-lock' : 'pencil-outline'}
                      size={16}
                      color={targetHasAccess ? '#B91C1C' : theme.accentDark}
                    />
                    <Text
                      style={[
                        styles.accessActionText,
                        { color: targetHasAccess ? '#B91C1C' : theme.accentDark },
                      ]}
                    >
                      {targetHasAccess ? 'Revoke edit access' : 'Give edit access'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {!canEdit && (
              <View style={styles.readOnlyNotice}>
                <MaterialCommunityIcons name="lock-outline" size={15} color="#92400E" />
                <Text style={styles.readOnlyText}>
                  You have read-only access. Ask an admin to give you edit
                  access from the Workers tab.
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pay Details</Text>
          <View style={styles.payCard}>
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Pay Per Hour:</Text>
              {isEditing && canEdit ? (
                <TextInput
                  style={styles.payInput}
                  value={payPerHour}
                  onChangeText={setPayPerHour}
                  keyboardType="numeric"
                />
              ) : (
                <Text style={styles.payValue}>${payPerHour}/hr</Text>
              )}
            </View>
            {isEditing && canEdit && (
              <TouchableOpacity
                style={[styles.savePayButton, { backgroundColor: theme.accent }]}
                onPress={handleSavePayRate}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.savePayButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            )}
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Hours This Month:</Text>
              <Text style={styles.payValue}>{totalHours.toFixed(2)} hrs</Text>
            </View>
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Monthly Total:</Text>
              <Text style={styles.payTotal}>${totalPay.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attendance History</Text>
          <FlatList
            data={recentClockings}
            renderItem={renderClockingItem}
            keyExtractor={(item, index) => `${item._row || index}`}
            scrollEnabled={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No recent clock-ins</Text>
              </View>
            }
          />
          <TouchableOpacity
            style={styles.showMore}
            onPress={() =>
              router.push(
                `/clock-history?workerId=${encodeURIComponent(
                  resolvedId || ''
                )}` as any
              )
            }
          >
            <Text style={[styles.showMoreText, { color: theme.accent }]}>
              Show more
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={16}
              color={theme.accent}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Work Performance</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>On-time arrivals</Text>
              <Text style={styles.statGridValue}>{performance.onTimeRate}%</Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Late clock-ins</Text>
              <Text style={styles.statGridValue}>{performance.lateCount}</Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Hours worked</Text>
              <Text style={styles.statGridValue}>
                {performance.hoursWorked.toFixed(2)}h
              </Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Assigned hours</Text>
              <Text style={styles.statGridValue}>
                {performance.assignedHours.toFixed(1)}h
              </Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Pay / hour</Text>
              <Text style={styles.statGridValue}>
                ${performance.payPerHour.toFixed(2)}
              </Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Pay this month</Text>
              <Text style={styles.statGridValue}>
                ${performance.pay.toFixed(2)}
              </Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Days worked</Text>
              <Text style={styles.statGridValue}>{performance.daysWorked}</Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Attendance</Text>
              <Text style={styles.statGridValue}>
                {performance.attendanceRate}%
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stats</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Avg Hours/Day</Text>
              <Text style={styles.statGridValue}>{avgHoursPerDay.toFixed(1)}</Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Total Hours</Text>
              <Text style={styles.statGridValue}>{totalHours.toFixed(1)}</Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Total Pay</Text>
              <Text style={styles.statGridValue}>${totalPay.toFixed(2)}</Text>
            </View>
            <View style={styles.statGridCard}>
              <Text style={styles.statGridLabel}>Total Break</Text>
              <Text style={styles.statGridValue}>{totalBreakTime}m</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    marginRight: 16,
  },
  headerInfo: {
    flex: 1,
  },
  workerName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  workerDesignation: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  editButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  analyticsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 6,
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  pickerContainer: {
    marginBottom: 16,
  },
  monthPicker: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  yearPicker: {
    flexDirection: 'row',
  },
  pickerButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  pickerButtonActive: {
    backgroundColor: '#00af5bff',
    borderColor: '#00af5bff',
  },
  pickerButtonText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
  },
  pickerButtonTextActive: {
    color: '#fff',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  infoHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 9,
    marginBottom: 12,
  },
  accessBadgeText: { fontSize: 10, fontWeight: '700', marginLeft: 4 },
  profileCard: { backgroundColor: '#fff', padding: 16, borderRadius: 12 },
  profileLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 7,
  },
  profileLineLabel: {
    fontSize: 12,
    color: '#64748B',
    width: 48,
    marginLeft: 8,
  },
  profileLineValue: { flex: 1, fontSize: 13, color: '#1E293B', fontWeight: '500' },
  editLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 8,
    marginBottom: 4,
  },
  profileInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 9,
    padding: 10,
    fontSize: 13,
    color: '#1E293B',
  },
  profileInputMultiline: { height: 72, textAlignVertical: 'top' },
  roleChipRow: { flexDirection: 'row', marginTop: 2, marginBottom: 4 },
  roleChip: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
  },
  roleChipText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#F8FAFC',
  },
  dropdownText: { fontSize: 13, color: '#1E293B', fontWeight: '600' },
  dropdownMenu: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    marginTop: 6,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  dropdownOptionText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  accessAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 10,
  },
  accessActionText: { fontSize: 12, fontWeight: '700', marginLeft: 6 },
  readOnlyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3E2',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  readOnlyText: { flex: 1, fontSize: 11, color: '#92400E', marginLeft: 7 },
  payCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  payRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  payLabel: {
    fontSize: 14,
    color: '#666',
  },
  payInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 6,
    width: 80,
    textAlign: 'right',
  },
  payValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  payTotal: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00af5bff',
  },
  savePayButton: {
    backgroundColor: '#00af5bff',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 10,
  },
  savePayButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  recordCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  recordDate: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
  },
  hoursBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  hoursText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4CAF50',
  },
  recordDetails: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timeItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 13,
    color: '#666',
    marginLeft: 4,
    marginRight: 4,
  },
  timeValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  breakLabel: {
    fontSize: 13,
    color: '#666',
    marginLeft: 4,
    marginRight: 4,
  },
  breakValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF9800',
  },
  dayTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayTotalLabel: {
    fontSize: 14,
    color: '#666',
  },
  dayTotalValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#00af5bff',
  },
  drawerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  drawerDate: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
  },
  drawerAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00af5bff',
  },
  drawerNotes: {
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
  },
  chartContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  emptyChart: {
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statGridCard: {
    width: '48%',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  statGridLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  statGridValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 6,
  },
  emptyContainer: {
    padding: 30,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  showMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  showMoreText: {
    fontSize: 12,
    fontWeight: '800',
    marginRight: 2,
  },
});
