import { defineRailway, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const bac_imason_hackathonVolume = volume("bac_imason_hackathon-volume", {
    alerts: {
      usage: {
        "100": {},
        "80": {},
        "95": {},
      },
    },
    allowOnlineResize: true,
    region: "europe-west4-drams3a",
    sizeMB: 5000,
  });

  const bac_imason_hackathon = service("bac_imason_hackathon", {
    replicas: {
      "europe-west4-drams3a": 1,
    },
    networking: {
      privateNetworkEndpoint: "bacimasonhackathon",
    },

    volumeMounts: {
      "/app/runtime": bac_imason_hackathonVolume,
    },

    start: "sh /app/scripts/start_railway.sh",
    healthcheck: "/api/project/status",
    healthcheckTimeout: 300,
  });

  return project("bac_imason_hackathon", {
    resources: [
      bac_imason_hackathon,
      bac_imason_hackathonVolume,
    ],
  });
});
