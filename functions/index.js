const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

const MCQ = "mcq";
const CHALLENGE = "challenge";
const QUESTIONS_COLLECTION = "questions";
const EXAMS_COLLECTION = "exams";
const CANDSTATUS_COLLECTION = "candidatestatus";
const USERS_COLLECTION = "users";

const INVALID_EXAM_CODE_MSG =
    "The exam code provided did not match our records";

const gmailEmail = functions.config().gmail.email;
const gmailPassword = functions.config().gmail.password;
const mailTransport = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: gmailEmail,
        pass: gmailPassword
    }
});

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

    const candStatusDoc = db.collection(CANDSTATUS_COLLECTION).doc(email);

    return candStatusDoc
        .get()
        .then(candDoc => {
            const candidateStatus = candDoc.data();

            const candExamCode = candidateStatus.examCode;

            if (candExamCode === examCode) {
                return candStatusDoc.set(
                    {
                        firstName,
                        lastName,
                        screeningStatus: 2
                    },
                    {
                        merge: true
                    }
                );
            }
            throw new functions.https.HttpsError(
                "invalid-argument",
                INVALID_EXAM_CODE_MSG
            );
        })
        .then(() => {
            const { uid } = context.auth;
            const userDb = db.collection(USERS_COLLECTION).doc(uid);

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

    const candStatusDoc = db.collection(CANDSTATUS_COLLECTION).doc(email);

    const questionsArr = [];

    const processQuestionsForExamFields = (question, index) => {
        if (question.type === MCQ) {
            return {
                qindex: index + 1,
                questionText: question.questionText,
                tsStarted: "",
                tsAnswered: "",
                duration: question.duration,
                type: MCQ,
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
            type: CHALLENGE,
            answer: question.answerTemplate
        };
    };

    return candStatusDoc
        .get()
        .then(candDoc => {
            const candidateStatus = candDoc.data();

            const candExamCode = candidateStatus.examCode;

            if (candExamCode === examCode) {
                candStatusDoc.set(
                    {
                        screeningStatus: 3
                    },
                    {
                        merge: true
                    }
                );

                return db
                    .collection(QUESTIONS_COLLECTION)
                    .orderBy("duration")
                    .get();
            }
            throw new functions.https.HttpsError(
                "invalid-argument",
                INVALID_EXAM_CODE_MSG
            );
        })
        .then(querySnapshot => {
            querySnapshot.forEach(doc => {
                const question = doc.data();
                if (question.type === MCQ) {
                    questionsArr.push({
                        questionText: question.questionText,
                        duration: question.duration,
                        type: MCQ,
                        options: question.options,
                        codeSnippet: question.codeSnippet
                    });
                } else {
                    questionsArr.push({
                        questionText: question.questionText,
                        duration: question.duration,
                        type: CHALLENGE,
                        answerTemplate: question.answerTemplate
                    });
                }
            });

            // separate the mcqs and challenges first
            const mcQuestions = questionsArr.filter(
                question => question.type === MCQ
            );
            const challenges = questionsArr.filter(
                question => question.type === CHALLENGE
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
                .collection(EXAMS_COLLECTION)
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

exports.setCandidateToRegistered = functions.auth.user().onCreate(user => {
    const db = admin.firestore();
    const { email } = user;

    const candStatusDoc = db.collection(CANDSTATUS_COLLECTION).doc(email);
    return candStatusDoc.get().then(() => {
        candStatusDoc.set(
            {
                screeningStatus: 1
            },
            {
                merge: true
            }
        );
    });
});

exports.updateExam = functions.firestore
    .document("exams/{email}")
    .onUpdate((change, context) => {
        const db = admin.firestore();

        const newValue = change.after.data();
        const { email } = context.params;
        if (newValue.examDone === true) {
            const candStatusDoc = db
                .collection(CANDSTATUS_COLLECTION)
                .doc(email);

            return candStatusDoc.get().then(() => {
                candStatusDoc.set(
                    {
                        screeningStatus: 4
                    },
                    {
                        merge: true
                    }
                );
            });
        }
        return null;
    });

exports.sendInviteToCandidate = functions.firestore
    .document("candidatestatus/{email}")
    .onCreate((snap, context) => {
        const candidateStatus = snap.data();
        const { examCode } = candidateStatus;
        const { email } = context.params;
        const registerUrl =
            "https://onlineassessment-4343b.firebaseapp.com/signup";

        const mailOptions = {
            from: "\"Infor PSSC Online Assessment\" <noreply@firebase.com>",
            to: email
        };

        mailOptions.subject = "Infor PSSC Online Assessment";
        mailOptions.html = `<p>Welcome to the Infor PSSC Online Assessment!
        <br/>Please register at: ${registerUrl}.<br/>After registering, please use this exam code when updating your profile: <strong>${examCode}</strong>
        <br/>You will need this exam code prior to taking the exam.
        <br/><br/>Thank you and happy coding!</p>`;

        return mailTransport
            .sendMail(mailOptions)
            .then(() => console.log("Exam code email sent to:", email))
            .catch(error =>
                console.error(
                    "There was an error while sending the email:",
                    error
                )
            );
    });
