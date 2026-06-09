# 🔌 popup/services/ — Επικοινωνία με εξωτερικές υπηρεσίες

Τα κομμάτια που **μιλάνε με «έξω»**: cloud, AniList, δεδομένα filler.

| Αρχείο | Τι κάνει (απλά) |
|---|---|
| **firebase-lib.js** | **Σύνδεση** (Google / email) + **cloud sync** με Firebase/Firestore. Εδώ μένει και η λογική συγχρονισμού (FirebaseLib + FirebaseSync). |
| **anilist-api.js** | **Ενσωμάτωση AniList**: σύνδεση (OAuth), η κάρτα AniList στο popup, και το «σπρώξιμο» (push) της προόδου σου (AnilistService + AniListIntegration). |
| **anilist-api-styles.js** | Το **CSS (στυλ)** της κάρτας AniList. |
| **filler-service.js** | Η **λογική filler**: ποια επεισόδια είναι filler, μέτρημα των canon επεισοδίων, υπολογισμός προόδου με βάση αυτά. |
