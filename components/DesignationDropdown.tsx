import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const OPTIONS = [
  { value: 'worker', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

/**
 * Reusable designation control.
 * - `editable` false → plain text.
 * - `editable` true  → inline dropdown (used by admins only).
 */
export default function DesignationDropdown({
  value,
  onChange,
  editable = false,
  accent = '#2563EB',
}: {
  value?: string | null;
  onChange?: (value: string) => void;
  editable?: boolean;
  accent?: string;
}) {
  const [open, setOpen] = useState(false);
  const normalized = (value || 'worker').toLowerCase();
  const label =
    normalized === 'manager'
      ? 'Manager'
      : normalized === 'admin'
      ? 'Admin'
      : 'Employee';

  if (!editable) {
    return <Text style={styles.plain}>{label}</Text>;
  }

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.control}
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={`Designation: ${label}`}
      >
        <Text style={styles.controlText}>{label}</Text>
        <MaterialCommunityIcons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color="#64748B"
        />
      </TouchableOpacity>
      {open && (
        <View style={styles.menu}>
          {OPTIONS.map((option) => {
            const active = option.value === normalized;
            return (
              <TouchableOpacity
                key={option.value}
                style={styles.option}
                onPress={() => {
                  setOpen(false);
                  if (!active) onChange?.(option.value);
                }}
              >
                <Text
                  style={[
                    styles.optionText,
                    active && { color: accent, fontWeight: '800' },
                  ]}
                >
                  {option.label}
                </Text>
                {active && (
                  <MaterialCommunityIcons
                    name="check"
                    size={13}
                    color={accent}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  plain: { fontSize: 11, color: '#64748B', fontWeight: '700' },
  wrap: { minWidth: 92 },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#F8FAFC',
  },
  controlText: { fontSize: 11, fontWeight: '700', color: '#334155' },
  menu: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  optionText: { fontSize: 11, color: '#475569', fontWeight: '600' },
});
