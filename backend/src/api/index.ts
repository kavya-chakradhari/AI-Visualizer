import { Router } from "express";
import healthRouter from "./health.js";
import datasetsRouter from "./datasets.js";
import dashboardsRouter from "./dashboards.js";
import commandsRouter from "./commands.js";
import aiRouter from "./ai.js";

const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use("/datasets", datasetsRouter);
apiRouter.use("/dashboards", dashboardsRouter);
apiRouter.use("/commands", commandsRouter);
apiRouter.use(aiRouter);

export default apiRouter;
