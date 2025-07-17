import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Animated,
  RefreshControl,
} from "react-native";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { useDispatch, useSelector } from "react-redux";
import {
  setItems,
  setLoading,
  setError,
  setSearchQuery,
  clearSearchQuery,
  selectFilteredItems,
  addToList,
  selectCartItemCount,
} from "@/redux/store/grocerySlice";
import GroceryItemCard from "../../components/GroceryItemCard";
import { useSheetData } from "@/assets/hooks/useSheetData";
import { RootState } from "@/redux/store";
import { Colors } from "@/assets/constants/colors";
import UsernameModal from "@/components/UsernameModal";
import { selectUserName } from "@/redux/store/userSlice";
import { router } from "expo-router";

const HomeScreen = () => {
  const dispatch = useDispatch();

  const {
    data,
    loading: sheetLoading,
    error: sheetError,
    refresh: refreshSheetData,
  } = useSheetData();
  const filteredItems = useSelector(selectFilteredItems);
  const searchQuery = useSelector((state: RootState) => state.grocery.searchQuery);
  const loading = useSelector((state: RootState) => state.grocery.loading);
  const error = useSelector((state: RootState) => state.grocery.error);
  const userName = useSelector(selectUserName);
  const cartItemCount = useSelector(selectCartItemCount);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [currentTime, setCurrentTime] = useState("");

  // Check if username exists on first render
  useEffect(() => {
    if (!userName) {
      setShowUsernameModal(true);
    }
  }, [userName]);

  // Update current time every minute
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 60000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (Array.isArray(data) && data.length > 0) {
      dispatch(setItems(data));
      fadeInItems();
    }
  }, [data, dispatch]);

  useEffect(() => {
    dispatch(setLoading(sheetLoading));
  }, [sheetLoading, dispatch]);

  useEffect(() => {
    if (sheetError) {
      dispatch(setError(sheetError.message || "Unknown error"));
    }
  }, [sheetError, dispatch]);

  const fadeInItems = () => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  };

  const handleRefresh = async () => {
    try {
      await refreshSheetData();
      fadeInItems();
    } catch (err) {
      dispatch(setError("Failed to refresh data"));
    }
  };

  const handleItemPress = (item: { Id: string; GroceryItem: string }) => {
    dispatch(addToList(item));
  };

  const handleSearchChange = (text: string) => {
    dispatch(setSearchQuery(text));
  };

  const handleClearSearch = () => {
    dispatch(clearSearchQuery());
  };

  const handleCartPress = () => {
    router.push("/(tabs)/list");
  };

  if (loading && (!filteredItems || filteredItems.length === 0)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <UsernameModal
        visible={showUsernameModal}
        currentName={userName || ""}
        onClose={() => setShowUsernameModal(false)}
      />
      <View style={styles.header}>
        <View style={styles.userInfoContainer}>
          {userName ? (
            <>
              <Text style={styles.greeting}>Hi,</Text>
              <TouchableOpacity onPress={() => setShowUsernameModal(true)}>
                <Text style={styles.userName}>{userName}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.headerText}>Welcome</Text>
          )}
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.time}>{currentTime}</Text>
          <TouchableOpacity 
            style={styles.cartContainer}
            onPress={handleCartPress}
          >
            <Ionicons name="cart-outline" size={24} color="#1E293B" />
            {cartItemCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartCount}>{cartItemCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <MaterialCommunityIcons
          name="magnify"
          size={20}
          color="#94A3B8"
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search items..."
          placeholderTextColor="#94A3B8"
          value={searchQuery}
          onChangeText={handleSearchChange}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={handleClearSearch}
            style={styles.clearButton}
          >
            <MaterialCommunityIcons name="close" size={20} color="#94A3B8" />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filteredItems || []}
        renderItem={({ item }) => (
          <GroceryItemCard
            item={item}
            onPress={handleItemPress}
            opacity={fadeAnim}
          />
        )}
        keyExtractor={(item) => item.Id}
        contentContainerStyle={styles.listContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            colors={[Colors.primary]}
            tintColor={Colors.primary}  
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons
              name="text-search"
              size={50}
              color="#CBD5E0"
            />
            <Text style={styles.emptyText}>No items found</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  userInfoContainer: {
    flexDirection: "column",
  },
  greeting: {
    fontSize: 14,
    color: Colors.primary,
    fontFamily: "Inter-Medium",
  },
  userName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1E293B",
    fontFamily: "Inter-SemiBold",
  },
  headerText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1E293B",
    fontFamily: "Inter-SemiBold",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  time: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1E293B",
    fontFamily: "Inter-SemiBold",
  },
  cartContainer: {
    marginLeft: 16,
    position: "relative",
  },
  cartBadge: {
    position: "absolute",
    right: -8,
    top: -8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  cartCount: {
    color: "#1E293B",
    fontSize: 12,
    fontWeight: "bold",
    fontFamily: "Inter-SemiBold",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    marginHorizontal: 20,
    marginVertical: 16,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontSize: 16,
    color: "#1E293B",
    fontFamily: "Inter-Medium",
  },
  clearButton: {
    padding: 4,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 60,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    color: "#94A3B8",
    fontFamily: "Inter-Medium",
  },
  errorText: {
    color: "#DC2626",
    fontSize: 16,
    padding: 16,
    textAlign: "center",
    fontFamily: "Inter-Medium",
  },
});

export default HomeScreen;