import { PORT, MAX_WORKERS } from "./config";
import server from "./app";
import cluster from "cluster";
import os from "os";

const numCPUs = os.cpus().length;

if (MAX_WORKERS > 1) {
    if (cluster.isPrimary) {
        for (let i = 0; i < numCPUs && i < MAX_WORKERS; i++) {
            cluster.fork();
        }

        cluster.on("exit", (worker) => {
            console.log(`Worker ${worker.process.pid} died`);
            cluster.fork();
        });
    } else {
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT} in worker ${process.pid}`);
        });
    }
} else {
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}
