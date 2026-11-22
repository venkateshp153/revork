# Revork Demo Data (Google Sheets)

The app no longer creates demo data itself. Instead, this Apps Script writes
demo rows directly into your actual Revork spreadsheet so every device and
role sees the same test data.

## Setup

1. Open your Revork workspace spreadsheet.
2. Click **Extensions → Apps Script**.
3. Replace the placeholder code with the contents of
   [`GoogleSheetsDemoData.gs`](./GoogleSheetsDemoData.gs).
4. Click **Save**.
5. Run the `seedDemoData` function once and approve the permission prompt.

After saving, a **Demo Data** menu appears in the spreadsheet:

- **Fill 28 rows in every main tab**
- **Clear demo rows**

## What it creates

| Tab | Rows | Notes |
| --- | --- | --- |
| `Workers` | 28 | Employees + 4 managers, with emails, phones and delivery spots |
| `Inventory` | 28 | Six categories, quantities and low-stock limits |
| `DeliveryLocations` | 28 | Assigned one per employee, with coordinates and a few priority stops |
| `Deliveries` | 28 | Delivered rows for today so the Proofs screen has data |
| `Clockings` | 28 | Today's clock-in/out data for the team view |

Demo records use IDs starting with `DEMO-`, so **Clear demo rows** only removes
the generated test data and leaves real records untouched.

## Notes

- The script uses today's date, so the demo deliveries/attendance appear on the
  current day.
- Run **Clear demo rows** before seeding again if you want a clean set.
- If a tab is missing, open the app once so onboarding creates every workspace
  tab, then run the script.
