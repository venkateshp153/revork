import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  describeGoogleMapsError,
  geocodeAddress,
  getCurrentLocation,
  getPlaceDetails,
  searchPlaces,
  type PlaceSuggestion,
  type RouteLocation,
} from '@/src/utils/routePlanner';

interface LocationPickerProps {
  label: string;
  value: RouteLocation | null;
  onChange: (location: RouteLocation) => void;
  onClear?: () => void;
  accent?: string;
  placeholder?: string;
}

export default function LocationPicker({
  label,
  value,
  onChange,
  onClear,
  accent = '#2563EB',
  placeholder = 'Search a Google address',
}: LocationPickerProps) {
  const [query, setQuery] = useState(value?.address || '');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value?.address && value.address !== query) {
      setQuery(value.address);
    }
    // Only react to external value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.address]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const text = query.trim();
    if (text.length < 3 || (value && text === value.address)) {
      setSuggestions([]);
      return () => {
        if (timer.current) clearTimeout(timer.current);
      };
    }

    timer.current = setTimeout(async () => {
      try {
        setLoading(true);
        const results = await searchPlaces(text);
        setSuggestions(results.slice(0, 6));
      } catch (error: any) {
        setSuggestions([]);
        Alert.alert(
          'Address search unavailable',
          describeGoogleMapsError(error) ||
            'Enable Google Places API for the app API key and try again.'
        );
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, value]);

  const chooseSuggestion = async (suggestion: PlaceSuggestion) => {
    try {
      setLoading(true);
      const location: RouteLocation =
        typeof suggestion.lat === 'number' && typeof suggestion.lng === 'number'
          ? {
              address:
                suggestion.description ||
                suggestion.mainText ||
                `${suggestion.lat}, ${suggestion.lng}`,
              lat: suggestion.lat,
              lng: suggestion.lng,
              placeId: suggestion.placeId,
            }
          : await getPlaceDetails(suggestion.placeId);
      setSuggestions([]);
      setQuery(location.address);
      onChange(location);
    } catch (error: any) {
      Alert.alert(
        'Could not use this address',
        describeGoogleMapsError(error) || 'Try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const useCurrent = async () => {
    try {
      setLocating(true);
      const location = await getCurrentLocation();
      setSuggestions([]);
      setQuery(location.address);
      onChange(location);
    } catch (error: any) {
      Alert.alert('Location unavailable', error?.message || 'Try again.');
    } finally {
      setLocating(false);
    }
  };

  // If the user types a full address and never taps a suggestion, resolve the
  // text directly instead of silently keeping the old (or empty) location.
  const applyTypedAddress = async () => {
    const text = query.trim();
    if (text.length < 3) return;
    if (value && text === value.address) return;
    try {
      setResolving(true);
      const location = await geocodeAddress(text);
      setSuggestions([]);
      setQuery(location.address);
      onChange(location);
    } catch (error: any) {
      Alert.alert(
        'Address not found',
        describeGoogleMapsError(error) ||
          'Pick a suggestion below, or paste coordinates like “12.9716, 77.5946”.'
      );
    } finally {
      setResolving(false);
    }
  };

  const typedNeedsResolving =
    query.trim().length >= 3 && (!value || query.trim() !== value.address);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <MaterialCommunityIcons name="magnify" size={18} color="#64748B" />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor="#94A3B8"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => {
            void applyTypedAddress();
          }}
        />
        {(loading || resolving) && (
          <ActivityIndicator size="small" color={accent} />
        )}
        {!!value && !!onClear && !loading && !resolving && (
          <TouchableOpacity
            onPress={() => {
              setQuery('');
              setSuggestions([]);
              onClear();
            }}
            accessibilityLabel={`Clear ${label}`}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="close-circle" size={17} color="#94A3B8" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.currentButton, { borderColor: accent }]}
          onPress={useCurrent}
          disabled={locating}
        >
          {locating ? (
            <ActivityIndicator size="small" color={accent} />
          ) : (
            <MaterialCommunityIcons
              name="crosshairs-gps"
              size={15}
              color={accent}
            />
          )}
          <Text style={[styles.currentText, { color: accent }]}>
            Use current location
          </Text>
        </TouchableOpacity>

        {typedNeedsResolving && (
          <TouchableOpacity
            style={[styles.currentButton, { borderColor: accent }]}
            onPress={() => {
              void applyTypedAddress();
            }}
            disabled={resolving}
          >
            <MaterialCommunityIcons
              name="map-search-outline"
              size={15}
              color={accent}
            />
            <Text style={[styles.currentText, { color: accent }]}>
              Use this address
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((suggestion) => (
            <TouchableOpacity
              key={suggestion.placeId}
              style={styles.suggestion}
              onPress={() => chooseSuggestion(suggestion)}
            >
              <MaterialCommunityIcons
                name="map-marker-outline"
                size={16}
                color="#64748B"
              />
              <View style={styles.suggestionText}>
                <Text style={styles.suggestionMain} numberOfLines={1}>
                  {suggestion.mainText}
                </Text>
                {!!suggestion.secondaryText && (
                  <Text style={styles.suggestionSecondary} numberOfLines={1}>
                    {suggestion.secondaryText}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
          {suggestions.some((suggestion) => suggestion.provider === 'osm') && (
            <View style={styles.suggestionSource}>
              <MaterialCommunityIcons
                name="information-outline"
                size={12}
                color="#94A3B8"
              />
              <Text style={styles.suggestionSourceText}>
                Results from OpenStreetMap · Google Places is unavailable
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    fontSize: 13,
    color: '#1E293B',
  },
  currentButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 6,
    marginRight: 8,
  },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap' },
  currentText: { fontSize: 10, fontWeight: '700', marginLeft: 4 },
  suggestions: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  suggestionText: { flex: 1, marginLeft: 6 },
  suggestionMain: { fontSize: 12, fontWeight: '700', color: '#1E293B' },
  suggestionSecondary: { fontSize: 10, color: '#64748B', marginTop: 1 },
  suggestionSource: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#F8FAFC',
  },
  suggestionSourceText: {
    fontSize: 9,
    color: '#94A3B8',
    marginLeft: 4,
    flex: 1,
  },
});
