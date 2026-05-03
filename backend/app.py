import os
import csv
from io import StringIO
import numpy as np
import pandas as pd
from functools import wraps
from flask import Flask, request, jsonify, render_template, redirect, url_for, session, make_response
from flask_cors import CORS
import joblib
from tensorflow.keras.models import load_model, Model

# 🔥 REMOVE WARNINGS
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

app = Flask(__name__)
CORS(app)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "rainfall-dashboard-secret")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))

APP_USERNAME = os.environ.get("APP_USERNAME", "admin")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "admin123")
USERS = {APP_USERNAME: APP_PASSWORD}

FEATURE_COLS = [
    "temperature", "dewpoint", "pressure",
    "wind_u", "wind_v", "cloud_cover", "humidity"
]

SEQUENCE_LENGTH = 12

# ================================
# LOAD MODELS
# ================================
def load_city(city):
    path = os.path.join(PROJECT_ROOT, city)

    lstm = load_model(f"{path}/lstm_finetuned.keras")

    extractor = Model(
        inputs=lstm.inputs,
        outputs=lstm.layers[-2].output
    )

    return {
        "extractor": extractor,
        "xgb": joblib.load(f"{path}/xgb_model.save"),
        "feature_scaler": joblib.load(f"{path}/feature_scaler.save"),
        "target_scaler": joblib.load(f"{path}/target_scaler.save"),
        "metrics": joblib.load(f"{path}/metrics.save"),
        "data": pd.read_csv(f"{path}/{city}.csv").dropna()
    }

cities = ["karaikal","kumbakonam","mayiladuthurai","thanjavur","tiruvarur"]
models = {c: load_city(c) for c in cities}


def login_required_json(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user"):
            return jsonify({"error": "Unauthorized"}), 401
        return fn(*args, **kwargs)
    return wrapper


def login_required_page(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user"):
            return redirect(url_for("login"))
        return fn(*args, **kwargs)
    return wrapper


def build_city_overview():
    overview = {}
    for city, model in models.items():
        latest = model["data"].iloc[-1]
        metrics = model["metrics"]
        overview[city] = {
            "temperature": round(float(latest["temperature"]), 1),
            "humidity": round(float(latest["humidity"]), 1),
            "pressure": round(float(latest["pressure"]), 1),
            "cloud_cover": round(float(latest["cloud_cover"]), 1),
            "mae": round(float(metrics["MAE"]), 4),
            "rmse": round(float(metrics["RMSE"]), 4),
            "r2": round(float(metrics["R2"]), 4),
            "medae": round(float(metrics["MedAE"]), 4),
            "mse": round(float(metrics["MSE"]), 4),
            "records": int(len(model["data"]))
        }
    return overview


CITY_OVERVIEW = build_city_overview()


def append_prediction_history(entry):
    history = session.get("prediction_history", [])
    history.insert(0, entry)
    session["prediction_history"] = history[:20]
    session["last_prediction"] = entry

# ================================
@app.route("/")
@login_required_page
def home():
    return render_template(
        "index.html",
        cities=cities,
        city_overview=CITY_OVERVIEW,
        user=session.get("user")
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("user"):
        return redirect(url_for("home"))

    error = None
    register_error = None
    register_success = None
    if request.method == "POST":
        action = request.form.get("action", "login")

        if action == "register":
            username = request.form.get("register_username", "").strip()
            password = request.form.get("register_password", "")
            confirm_password = request.form.get("confirm_password", "")

            if not username or not password:
                register_error = "Username and password are required."
            elif username in USERS:
                register_error = "Username already exists."
            elif password != confirm_password:
                register_error = "Passwords do not match."
            else:
                USERS[username] = password
                register_success = "Registration successful. You can now sign in."
        else:
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")

            if USERS.get(username) == password:
                session["user"] = username
                return redirect(url_for("home"))

            error = "Invalid username or password."

    return render_template(
        "login.html",
        error=error,
        register_error=register_error,
        register_success=register_success,
        default_username=APP_USERNAME,
        default_password=APP_PASSWORD,
        sequence_length=SEQUENCE_LENGTH
    )


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/history")
@login_required_page
def history():
    return render_template(
        "history.html",
        user=session.get("user"),
        prediction_history=session.get("prediction_history", [])
    )


@app.route("/download-report")
@login_required_page
def download_report():
    report = session.get("last_prediction")
    if not report:
        return redirect(url_for("home"))

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Field", "Value"])
    writer.writerow(["Area", report["city"]])
    writer.writerow(["Rainfall (mm)", report["rainfall"]])
    writer.writerow(["Generated On", report["generated_at"]])
    writer.writerow(["MAE", report["metrics"]["MAE"]])
    writer.writerow(["RMSE", report["metrics"]["RMSE"]])
    writer.writerow(["R2", report["metrics"]["R2"]])
    writer.writerow(["MedAE", report["metrics"]["MedAE"]])
    writer.writerow(["MSE", report["metrics"]["MSE"]])

    response = make_response(output.getvalue())
    response.headers["Content-Type"] = "text/csv"
    response.headers["Content-Disposition"] = "attachment; filename=rainfall_report.csv"
    return response

# ================================
@app.route("/predict", methods=["POST"])
@login_required_json
def predict():
    data = request.json
    city = data["city"]
    user_input = data["features"]

    m = models[city]

    df = m["data"]

    # SEQUENCE
    past = df[FEATURE_COLS].values[-11:]
    full_seq = np.vstack([past, user_input])

    scaled = m["feature_scaler"].transform(
        pd.DataFrame(full_seq, columns=FEATURE_COLS)
    )

    lstm_input = scaled.reshape(1, 12, 7)

    embed = m["extractor"].predict(lstm_input, verbose=0)

    hybrid_input = np.concatenate([embed.flatten(), scaled[-1]])

    pred_scaled = m["xgb"].predict(
        hybrid_input.reshape(1, -1)
    ).reshape(-1, 1)

    pred = m["target_scaler"].inverse_transform(pred_scaled)[0][0]
    pred = max(0, float(pred))  # no negative rain

    # ================================
    # 🔥 LOAD JUPYTER GRAPH (FIXED)
    # ================================
    graph_df = pd.read_csv(os.path.join(PROJECT_ROOT, city, "graph_data.csv"))

    actual = np.maximum(graph_df["actual"].values, 0)
    predicted = np.maximum(graph_df["predicted"].values, 0)

    # Match the notebook plot exactly: first 300 test points.
    plot_points = 300
    actual_plot = actual[:plot_points]
    predicted_plot = predicted[:plot_points]

    history_entry = {
        "city": city.title(),
        "rainfall": round(pred, 4),
        "generated_at": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
        "metrics": {
            "MAE": round(float(m["metrics"]["MAE"]), 4),
            "RMSE": round(float(m["metrics"]["RMSE"]), 4),
            "R2": round(float(m["metrics"]["R2"]), 4),
            "MedAE": round(float(m["metrics"]["MedAE"]), 4),
            "MSE": round(float(m["metrics"]["MSE"]), 4),
        }
    }
    append_prediction_history(history_entry)

    return jsonify({
        "rainfall": round(pred, 4),
        "metrics": m["metrics"],
        "graph": {
            "actual": actual_plot.tolist(),
            "predicted": predicted_plot.tolist()
        }
    })

# ================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
