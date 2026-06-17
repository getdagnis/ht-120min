#!/bin/bash

# Configuration
ADMIN_MANAGER_ID=8777402
TARGET_MANAGER_IDS=(12306434 13304362 1315661 11419808 11963511 13181044 1123755 712393 713120 711686 13613923 5798176 13673513 186307 11120196)

# Loop to create ads
for manager_id in "${TARGET_MANAGER_IDS[@]}"; do
  echo "Creating ad for manager $manager_id..."
  # Fetch first team ID (requires some effort via curl, but for now let's just retry and hope or pick one if known)
  # Actually, the API returns available teams if multiple are found.
  # Let's just try to post and if it fails due to multiple, we can't easily fix in curl.
  # Wait, the admin-create logic: if targetTeamId is not provided, it defaults to the first team IF length is 1.
  # I'll modify admin-create to default to the first team if multiple found.
  curl -X POST http://localhost:5173/api/matchmaker/admin-create \
    -H "Content-Type: application/json" \
    -d "{
      \"adminManagerId\": \"$ADMIN_MANAGER_ID\",
      \"managerId\": \"$manager_id\",
      \"message\": \"Looking for a friendly match!\",
      \"matchType\": \"120min\",
      \"opponentLocation\": \"any\",
      \"homeAway\": \"any\"
    }"
  sleep 1
done

echo "Seeding complete."
