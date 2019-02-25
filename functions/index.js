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
            "The function must be called with all arguments having values"
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

/*
    This function generates 5 multiple choice questions and 5 programming challenges 
    from a pool of questions,then saves it inside the exam collection
    
*/

exports.generateExam = functions.https.onCall((data, context) => {
    const { email, examCode, language } = data;
    const isInvalid = !email || !examCode || !language;

    if (!context.auth) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            "The function must be called while authenticated."
        );
    }

    if (isInvalid) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "The function must be called with all arguments having values"
        );
    }

    const db = admin.firestore();

    const candStatusDoc = db.collection("candidatestatus").doc(email);

    const questionsArr = [];

    const processQuestionsForExamFields = (question, index) => {
        if (question.type === "mcq") {
            return {
                qindex: index + 1,
                questionText: question.questionText,
                tsStarted: "",
                tsAnswered: "",
                duration: question.duration,
                type: "mcq",
                options: question.options,
                answer: "",
                codeSnippet: question.codeSnippet
            };
        }
        return {
            qindex: index + 1,
            questionText: question.questionText,
            tsStarted: "",
            tsAnswered: "",
            duration: question.duration,
            type: "challenge",
            answer: question.answerTemplate
        };
    };

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
            return db
                .collection("questions")
                .orderBy("duration")
                .get();
        })
        .then(querySnapshot => {
            querySnapshot.forEach(doc => {
                const question = doc.data();
                if (question.type === "mcq") {
                    questionsArr.push({
                        questionText: question.questionText,
                        duration: question.duration,
                        type: "mcq",
                        options: question.options,
                        codeSnippet: question.codeSnippet
                    });
                } else {
                    questionsArr.push({
                        questionText: question.questionText,
                        duration: question.duration,
                        type: "challenge",
                        answerTemplate: question.answerTemplate
                    });
                }
            });

            // separate the mcqs and challenges first
            const mcQuestions = questionsArr.filter(
                question => question.type === "mcq"
            );
            const challenges = questionsArr.filter(
                question => question.type === "challenge"
            );

            let examQuestions = [];

            // don't even bother randomizing if question bank is <= 10
            if (challenges.length <= 5 && mcQuestions.length <= 5) {
                examQuestions = mcQuestions.concat(challenges);
            } else {
                const getRandomNumberFromNum = num =>
                    Math.floor(Math.random() * num);

                for (let i = 0; i < 5; i += 1) {
                    const randomMCQIndex = getRandomNumberFromNum(
                        mcQuestions.length
                    );

                    examQuestions.push(mcQuestions[randomMCQIndex]);
                    mcQuestions.splice(randomMCQIndex, 1);
                }
                for (let i = 0; i < 5; i += 1) {
                    const randomChallengeIndex = getRandomNumberFromNum(
                        challenges.length
                    );

                    examQuestions.push(challenges[randomChallengeIndex]);
                    challenges.splice(randomChallengeIndex, 1);
                }
            }
            const finalExamQuestions = examQuestions.map(
                processQuestionsForExamFields
            );

            return db
                .collection("exams")
                .doc(email)
                .set({
                    questions: finalExamQuestions,
                    currentQuestionIndex: 1,
                    examStarted: false,
                    examDone: false,
                    languageTaken: language
                });
        })
        .then(() => {
            return "Exam successfully generated";
        })
        .catch(e => {
            throw new functions.https.HttpsError(
                "internal",
                "Something went wrong",
                e
            );
        });
});
