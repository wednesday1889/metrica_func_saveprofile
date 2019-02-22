const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.saveProfile = functions.https.onCall((data, context) => {
    const { email, examCode, firstName, lastName } = data;
    const isInvalid = !email || !examCode || !firstName || !lastName;

    if (!context.auth) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            "The function must be called while authenticated."
        );
    }

    if (isInvalid) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "The function must be called with all arguments must have values"
        );
    }

    const db = admin.firestore();

    const candStatusDoc = db.collection("candidatestatus").doc(email);

    return candStatusDoc
        .get()
        .then(candDoc => {
            const candidateStatus = candDoc.data();

            const candExamCode = candidateStatus.examCode;

            if (candExamCode === examCode) {
                return candStatusDoc.set(
                    {
                        profileDone: true
                    },
                    {
                        merge: true
                    }
                );
            }
            throw new functions.https.HttpsError(
                "invalid-argument",
                "The exam code provided did not match our records"
            );
        })
        .then(() => {
            const { uid } = context.auth;
            const userDb = db.collection("users").doc(uid);

            return userDb.set(
                {
                    firstName,
                    lastName,
                    examCode
                },
                {
                    merge: true
                }
            );
        })
        .then(() => {
            return "Profile successfully updated";
        })
        .catch(e => {
            throw new functions.https.HttpsError(
                "internal",
                "Something went wrong",
                e
            );
        });
});
