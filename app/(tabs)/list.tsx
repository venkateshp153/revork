import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Modal,
  Share,
  Platform,
  Alert,
} from "react-native";
import { BlurView } from "expo-blur";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSelector, useDispatch } from "react-redux";
import {
  selectListItems,
  incrementQuantity,
  decrementQuantity,
  removeFromList,
  clearList,
} from "@/redux/store/grocerySlice";
import { Colors } from "@/assets/constants/colors";

export default function List() {
  const dispatch = useDispatch();
  const listItems = useSelector(selectListItems);
  const [showGeneratedList, setShowGeneratedList] = useState(false);
  const [generatedListText, setGeneratedListText] = useState("");

  const handleGenerate = () => {
    const formattedList = listItems
      .map(
        (item, index) =>
          `${index + 1}.) ${item.GroceryItem} ➖ ${item.quantity}`
      )
      .join("\n");
    setGeneratedListText(formattedList);
    setShowGeneratedList(true);
  };

  const handleCloseGeneratedList = () => {
    setShowGeneratedList(false);
    setGeneratedListText("");
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `List of things we need at store:\n\n${generatedListText}`,
        title: "My Grocery List",
      });
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error
          ? `Failed to share the list: ${error.message}`
          : "Failed to share the list"
      );
    }
  };

  const handleClearList = () => {
    Alert.alert(
      "Clear List",
      "Are you sure you want to clear the entire list?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => dispatch(clearList()),
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Make a List</Text>
        {listItems.length > 0 && (
          <TouchableOpacity
            onPress={handleClearList}
            style={styles.clearButton}
            accessibilityRole="button"
            accessibilityLabel="Clear entire list"
          >
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={listItems}
        keyExtractor={(item, index) => item.Id || `list-${index}`}
        renderItem={({ item }) => (
          <View style={styles.itemContainer}>
            <Text style={styles.itemName}>{item.GroceryItem}</Text>

            <View style={styles.quantityControls}>
              <TouchableOpacity
                onPress={() => dispatch(decrementQuantity(item.Id))}
                style={styles.quantityButton}
                disabled={item.quantity <= 1}
                accessibilityRole="button"
                accessibilityLabel={`Decrease quantity of ${item.GroceryItem}`}
                accessibilityState={{ disabled: item.quantity <= 1 }}
              >
                <MaterialCommunityIcons
                  name="minus"
                  size={20}
                  color={item.quantity <= 1 ? Colors.disabled : Colors.onPrimary}
                />
              </TouchableOpacity>

              <Text style={styles.quantityText}>{item.quantity}</Text>

              <TouchableOpacity
                onPress={() => dispatch(incrementQuantity(item.Id))}
                style={styles.quantityButton}
                accessibilityRole="button"
                accessibilityLabel={`Increase quantity of ${item.GroceryItem}`}
              >
                <MaterialCommunityIcons
                  name="plus"
                  size={20}
                  color={Colors.onPrimary}
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => dispatch(removeFromList(item.Id))}
              style={styles.deleteButton}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.GroceryItem} from the list`}
            >
              <MaterialCommunityIcons
                name="delete"
                size={20}
                color={Colors.danger}
              />
            </TouchableOpacity>
          </View>
        )}
        contentContainerStyle={[
          styles.listContent,
          listItems.length === 0 && { flex: 1 },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons
              name="cart-outline"
              size={50}
              color={Colors.disabled}
            />
            <Text style={styles.emptyText}>Your list is empty</Text>
            <Text style={styles.emptySubText}>
              Add items from the Home screen
            </Text>
          </View>
        }
      />

      {listItems.length > 0 && (
        <TouchableOpacity
          onPress={handleGenerate}
          style={styles.generateButton}
          accessibilityRole="button"
          accessibilityLabel="Generate list"
        >
          <Text style={styles.generateButtonText}>Generate List</Text>
        </TouchableOpacity>
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={showGeneratedList}
        onRequestClose={handleCloseGeneratedList}
      >
        <View style={styles.modalContainer}>
          {/* iOS renders a true blur; Android falls back to a translucent
              dark overlay since BlurView support there is unreliable. */}
          {Platform.OS === "ios" ? (
            <BlurView
              intensity={90}
              tint="light"
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View
              style={[StyleSheet.absoluteFill, styles.overlayFallback]}
            />
          )}

          <TouchableOpacity
            style={styles.blurTouchable}
            activeOpacity={1}
            onPress={handleCloseGeneratedList}
            accessibilityRole="button"
            accessibilityLabel="Close generated list"
          />

          <View style={styles.generatedListContainer}>
            <View style={styles.generatedListHeader}>
              <Text style={styles.generatedListTitle}>
                List of things we need at store
              </Text>
              <TouchableOpacity
                onPress={handleCloseGeneratedList}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Close generated list"
              >
                <MaterialCommunityIcons
                  name="close"
                  size={24}
                  color={Colors.subtleText}
                />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.generatedListScroll}
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              <Text style={styles.generatedListText}>{generatedListText}</Text>
            </ScrollView>

            <View style={styles.actionButtonsContainer}>
              <TouchableOpacity
                onPress={handleShare}
                style={styles.actionButton}
                accessibilityRole="button"
                accessibilityLabel="Share list"
              >
                <MaterialCommunityIcons
                  name="share-variant"
                  size={24}
                  color={Colors.onPrimary}
                />
                <Text style={styles.actionButtonText}>Share List</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.poweredByText}>powered by vork</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.screenBackground,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 24,
    paddingBottom: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.heading,
  },
  clearButton: {
    backgroundColor: Colors.clearBtnBackground,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  clearButtonText: {
    color: Colors.clearBtnText,
    fontWeight: "600",
  },
  listContent: {
    paddingBottom: 100,
    paddingTop: 8,
  },
  itemContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  itemName: {
    flex: 1,
    fontSize: 16,
    color: Colors.heading,
    fontWeight: "500",
  },
  quantityControls: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 10,
  },
  quantityButton: {
    backgroundColor: Colors.controlsBackground,
    borderRadius: 20,
    width: 30,
    height: 30,
    justifyContent: "center",
    alignItems: "center",
  },
  quantityText: {
    marginHorizontal: 10,
    fontSize: 16,
    minWidth: 24,
    textAlign: "center",
    fontWeight: "600",
    color: Colors.heading,
  },
  deleteButton: {
    padding: 8,
    marginLeft: 4,
  },
  generateButton: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  generateButtonText: {
    color: Colors.onPrimary,
    fontSize: 18,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    color: Colors.mutedText,
    marginTop: 16,
    fontWeight: "500",
  },
  emptySubText: {
    fontSize: 14,
    color: Colors.subtleText,
    marginTop: 8,
  },
  modalContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  overlayFallback: {
    backgroundColor: Colors.overlayFallback,
  },
  blurTouchable: {
    ...StyleSheet.absoluteFillObject,
  },
  generatedListContainer: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === "ios" ? 32 : 24,
    maxHeight: "70%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  generatedListHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  generatedListTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.heading,
    flex: 1,
    paddingRight: 16,
  },
  closeButton: {
    padding: 4,
  },
  generatedListScroll: {
    marginBottom: 16,
  },
  generatedListText: {
    fontSize: 16,
    color: Colors.bodyText,
    lineHeight: 24,
  },
  actionButtonsContainer: {
    marginTop: 8,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.success,
  },
  actionButtonText: {
    color: Colors.onPrimary,
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  poweredByText: {
    textAlign: "center",
    color: Colors.subtleText,
    fontSize: 12,
    marginTop: 8,
  },
});
