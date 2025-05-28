import express, { Express, NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import path from "path";
import http, { Server } from "http";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import i18n from "i18n";
import i18nExpress from "i18n-express";
import {
    MONGODB_URI,
    COOKIE_SESSION_KEY1,
    COOKIE_SESSION_KEY2,
    SUPPORTED_LANGUAGES
} from "./config";
import MongoStore from "connect-mongo";
import passport from "passport";
import session from "express-session";
import "./strategies/google";
import { isAuthorized, isNotAuthorized } from "./utils/auth";

const app: Express = express();
const server: Server = http.createServer(app);

mongoose.connect(MONGODB_URI);

app.use(cookieParser());

app.use(
    session({
        secret: [COOKIE_SESSION_KEY1, COOKIE_SESSION_KEY2],
        name: "oauth2",
        store: MongoStore.create({
            mongoUrl: MONGODB_URI
        }),
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
    })
);

app.use(passport.initialize());
app.use(passport.session());

i18n.configure({
    locales: SUPPORTED_LANGUAGES, // ["es", "en"],
    defaultLocale: "es",
    directory: path.join(__dirname, "../locales"),
    autoReload: true,
    updateFiles: false,
    queryParameter: "lang",
    cookie: "lang",
    objectNotation: true,
    syncFiles: true,
    fallbacks: {
        en: "es"
    },
    api: {
        __: "translate",
        __n: "translateN"
    }
});
app.use(i18n.init);
app.locals.__ = i18n.__;
app.locals.__n = i18n.__n;
app.locals.SUPPORTED_LANGUAGES = SUPPORTED_LANGUAGES;
app.use(
    i18nExpress({
        translationsPath: path.join(__dirname, "../locales"),
        siteLangs: SUPPORTED_LANGUAGES,
        textsVarName: "translation",
        cookieLangName: "lang",
        defaultLang: "es"
    })
);
app.use((req, res, next) => {
    const protocol = "https"; // req.protocol;
    const host = req.headers.host;
    app.locals.baseURL = `${protocol}://${host}`;
    next();
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));

app.use(express.static("public"));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

import indexRouter from "./routes/index";
import authRouter from "./routes/auth";
import apiRouter from "./routes/api";

app.use("/", indexRouter);
app.use("/api", apiRouter);
app.use("/auth", isNotAuthorized, authRouter);

// CSRF erorr
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err.code !== "EBADCSRFTOKEN") return next(err);

    // Handle CSRF token errors here
    res.status(403).end();
    console.log("CSRF error");
});

app.use((req: Request, res: Response) => {
    res.status(404).render("errors/404");
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, req: Request, res: Response) => {
    console.error(err.stack);
    res.status(500).render("errors/500", {
        err: err,
        stack: err.stack.split(path.dirname(__dirname)).join("{App}")
    });
});

export default server;
